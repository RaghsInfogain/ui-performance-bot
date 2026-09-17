package PlaywrightUIPageload;

import java.util.Map;

public final class ConfigHelper {

    private ConfigHelper() {}

    public static boolean parseBool(String value) {
        if (value == null) return false;
        String v = value.trim();
        return v.equalsIgnoreCase("true") || v.equalsIgnoreCase("yes") || v.equals("1");
    }

    public static boolean isHeadless(Map<String, String> config) {
        return parseBool(config.get("Headless_Mode"));
    }

    public static long getThinkTimeMs(Map<String, String> config) {
        try {
            return Long.parseLong(config.getOrDefault("Think_Time", "0").trim());
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    /** @return duration in seconds, or -1 if unlimited */
    public static double getTestDurationSeconds(Map<String, String> config) {
        String raw = config.get("Test_Duration_Seconds");
        if (raw == null || raw.trim().isEmpty() || raw.equalsIgnoreCase("NA") || raw.equals("0")) {
            return -1;
        }
        try {
            return Double.parseDouble(raw.trim());
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    public static boolean isWithinDuration(long startTimeMs, double durationSeconds) {
        if (durationSeconds < 0) return true;
        return (System.currentTimeMillis() - startTimeMs) < (long) (durationSeconds * 1000);
    }

    public static int getMultiThreading(Map<String, String> config) {
        try {
            int n = Integer.parseInt(config.getOrDefault("Multi_Threading", "1").trim());
            return Math.max(1, n);
        } catch (NumberFormatException e) {
            return 1;
        }
    }

    public static void sleepThinkTime(Map<String, String> config) {
        long ms = getThinkTimeMs(config);
        if (ms > 0) {
            try {
                Thread.sleep(ms);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }
}
