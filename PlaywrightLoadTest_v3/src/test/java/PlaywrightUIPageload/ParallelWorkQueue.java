package PlaywrightUIPageload;

import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Distributes discrete work items across N worker threads without locking.
 */
public final class ParallelWorkQueue<T> {

    private final List<T> items;
    private final boolean cycleUntilStopped;
    private final AtomicInteger cursor = new AtomicInteger(0);

    public ParallelWorkQueue(List<T> items, boolean cycleUntilStopped) {
        this.items = items;
        this.cycleUntilStopped = cycleUntilStopped;
    }

    /**
     * Claims the next item for this worker.
     * Non-cycle mode: each item is handed out at most once.
     * Cycle mode: items rotate indefinitely (duration mode); caller stops via {@link ExecutionGovernor}.
     */
    public T claimNext() {
        if (items.isEmpty()) {
            return null;
        }
        int i = cursor.getAndIncrement();
        if (!cycleUntilStopped) {
            return i < items.size() ? items.get(i) : null;
        }
        int index = i % items.size();
        if (i > 0 && index == 0) {
            System.out.println("All URLs tested once — restarting from the beginning (duration mode).");
        }
        return items.get(index);
    }
}
