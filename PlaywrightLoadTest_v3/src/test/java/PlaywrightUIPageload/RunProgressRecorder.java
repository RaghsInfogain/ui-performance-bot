package PlaywrightUIPageload;

import org.json.JSONObject;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.Date;

/** Append-only progress log so the API/UI can show URLs as they complete. */
public final class RunProgressRecorder {

    private static final Object LOCK = new Object();

    private RunProgressRecorder() {}

    public static void record(String resultDirectory, String pageUrl, String transaction,
                              long pageLoadTime, String elementLoadTime, String testStatus,
                              String failureReason, double performanceScore) {
        try {
            JSONObject entry = new JSONObject();
            entry.put("timestamp", new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date()));
            entry.put("pageUrl", pageUrl);
            entry.put("transaction", transaction != null ? transaction : "");
            entry.put("pageLoadTime", pageLoadTime);
            entry.put("elementLoadTime", elementLoadTime != null ? elementLoadTime : "N/A");
            entry.put("testStatus", testStatus != null ? testStatus : "PASS");
            entry.put("failureReason", failureReason != null ? failureReason : "");
            entry.put("performanceScore", performanceScore);

            File progressFile = new File(resultDirectory, "run-progress.jsonl");
            synchronized (LOCK) {
                try (FileWriter w = new FileWriter(progressFile, true)) {
                    w.append(entry.toString()).append('\n');
                }
            }
            System.out.println("[Progress] URL completed: " + pageUrl + " (" + pageLoadTime + "ms)");
        } catch (IOException e) {
            System.err.println("Failed to write progress for " + pageUrl + ": " + e.getMessage());
        }
    }
}
