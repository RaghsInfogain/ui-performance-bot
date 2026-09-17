package PlaywrightUIPageload;

import java.io.File;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Coordinates duration limits, user stop signals, and in-flight work draining.
 * When duration expires or stop is requested, no new URLs are started; workers finish current URLs first.
 */
public final class ExecutionGovernor {

    private volatile long startTimeMs;
    private final double durationSeconds;
    private final boolean durationEnabled;
    private final File stopSignalFile;
    private final AtomicBoolean stopRequested = new AtomicBoolean(false);
    private final AtomicBoolean durationReached = new AtomicBoolean(false);
    private final AtomicBoolean durationClockStarted = new AtomicBoolean(false);
    private final AtomicInteger inFlight = new AtomicInteger(0);

    private ExecutionGovernor(long startTimeMs, double durationSeconds, boolean durationEnabled, File stopSignalFile) {
        this.startTimeMs = startTimeMs;
        this.durationSeconds = durationSeconds;
        this.durationEnabled = durationEnabled;
        this.stopSignalFile = stopSignalFile;
    }

    public static ExecutionGovernor create(String resultDirectory, double durationSeconds) {
        File stopFile = new File(resultDirectory, ".stop");
        return new ExecutionGovernor(-1, durationSeconds, durationSeconds >= 0, stopFile);
    }

    /**
     * Starts the duration clock after all worker browsers are ready.
     * Browser download / launch time is excluded from the configured test duration.
     */
    public void startDurationClock() {
        if (!durationEnabled) {
            return;
        }
        if (durationClockStarted.compareAndSet(false, true)) {
            startTimeMs = System.currentTimeMillis();
            durationReached.set(false);
            System.out.println("Test duration clock started (" + durationSeconds + "s).");
        }
    }

    /** True while this worker may claim another URL / flow. */
    public boolean shouldAcceptNewWork() {
        if (stopRequested.get() || isStopSignalPresent()) {
            if (!stopRequested.get()) {
                stopRequested.set(true);
                System.out.println("Stop signal detected — finishing in-flight tests, no new work will start.");
            }
            return false;
        }
        if (durationEnabled && durationReached.get()) {
            return false;
        }
        if (durationEnabled && durationClockStarted.get()
                && !ConfigHelper.isWithinDuration(startTimeMs, durationSeconds)) {
            durationReached.set(true);
            System.out.println("Test duration reached — finishing in-flight tests, no new work will start.");
            return false;
        }
        return true;
    }

    public void workStarted() {
        inFlight.incrementAndGet();
    }

    public void workFinished() {
        inFlight.decrementAndGet();
        synchronized (inFlight) {
            inFlight.notifyAll();
        }
    }

    public int inFlightCount() {
        return inFlight.get();
    }

    public void awaitInflightCompletion(long maxWaitMs) throws InterruptedException {
        long deadline = System.currentTimeMillis() + maxWaitMs;
        synchronized (inFlight) {
            while (inFlight.get() > 0 && System.currentTimeMillis() < deadline) {
                inFlight.wait(250);
            }
        }
        int remaining = inFlight.get();
        if (remaining > 0) {
            System.err.println("Warning: " + remaining + " in-flight test(s) did not finish within drain window.");
        } else {
            System.out.println("All in-flight tests completed.");
        }
    }

    public void requestStop() {
        stopRequested.set(true);
    }

    private boolean isStopSignalPresent() {
        return stopSignalFile.exists();
    }
}
