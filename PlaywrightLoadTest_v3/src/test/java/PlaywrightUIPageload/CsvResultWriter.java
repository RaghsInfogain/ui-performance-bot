package PlaywrightUIPageload;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;

/** RFC4180-safe CSV writer for UEM result reports. */
public final class CsvResultWriter {

    public static final String UEM_HEADER =
            "RUN_ID,Timestamp,HostName,Transaction,Page URL,First Contentful Paint,Last Contentful Paint,"
                    + "Total Blocking Time,Cumulative Layout Shift,Speed Index,Performance Score,Page Load Time,"
                    + "Network Time,DNS Lookup Time,Connection Time,Server Processing Time,Response Time,"
                    + "Browser Time,DOM Interaction Time,DOM Complete Time,Playwright Full Page Load Time,"
                    + "Element Load Time,Test Status,Failure Reason,Audit Titles,Audit Scores,TBT Savings\n";

    private static final Object LOCK = new Object();

    private CsvResultWriter() {}

    public static String escape(String value) {
        if (value == null) return "";
        String s = value;
        if (s.contains(",") || s.contains("\"") || s.contains("\n") || s.contains("\r")) {
            return "\"" + s.replace("\"", "\"\"") + "\"";
        }
        return s;
    }

    public static void ensureHeader(String resultFilename) throws IOException {
        synchronized (LOCK) {
            File file = new File(resultFilename);
            if (!file.exists() || file.length() == 0) {
                try (FileWriter w = new FileWriter(resultFilename, true)) {
                    w.append(UEM_HEADER);
                }
            }
        }
    }

    public static void appendRow(String resultFilename, String... fields) throws IOException {
        StringBuilder row = new StringBuilder();
        for (int i = 0; i < fields.length; i++) {
            if (i > 0) row.append(',');
            row.append(escape(fields[i]));
        }
        row.append('\n');
        synchronized (LOCK) {
            try (FileWriter w = new FileWriter(resultFilename, true)) {
                w.append(row);
            }
        }
    }
}
