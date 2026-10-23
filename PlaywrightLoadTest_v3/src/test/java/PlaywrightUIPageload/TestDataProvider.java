package PlaywrightUIPageload;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Data-driven execution for scripted flows. Rows come from a CSV whose header row names the
 * variables; steps reference them as ${column}. Each flow iteration takes one row:
 *   sequential - next row in order, shared across threads, wraps around at the end
 *   random     - any row
 *   unique     - each row used once; execution stops when the data runs out
 */
public class TestDataProvider {

    private static final Pattern PLACEHOLDER = Pattern.compile("\\$\\{([A-Za-z_][A-Za-z0-9_.-]*)\\}");

    private final List<String> headers;
    private final List<Map<String, String>> rows;
    private final String mode;
    private final AtomicInteger cursor = new AtomicInteger(0);

    private TestDataProvider(List<String> headers, List<Map<String, String>> rows, String mode) {
        this.headers = headers;
        this.rows = rows;
        this.mode = mode;
    }

    /** Load from the properties of a run; returns null when the script has no test data. */
    public static TestDataProvider fromProperties(java.util.Properties properties) {
        String path = properties.getProperty("ScriptedTestDataFilePath", "").trim();
        if (path.isEmpty()) return null;
        File file = new File(path);
        if (!file.exists()) {
            System.err.println("Test data file not found, running without data: " + path);
            return null;
        }
        String mode = properties.getProperty("ScriptedTestDataMode", "sequential").trim().toLowerCase();
        if (!mode.equals("random") && !mode.equals("unique")) mode = "sequential";
        try {
            return load(file, mode);
        } catch (IOException e) {
            System.err.println("Could not read test data file " + path + ": " + e.getMessage());
            return null;
        }
    }

    private static TestDataProvider load(File file, String mode) throws IOException {
        List<String> headers = null;
        List<Map<String, String>> rows = new ArrayList<>();
        try (BufferedReader br = new BufferedReader(new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
            String line;
            while ((line = br.readLine()) != null) {
                if (line.trim().isEmpty()) continue;
                String[] cells = TestDataManager.splitCsvLine(line);
                if (headers == null) {
                    headers = new ArrayList<>();
                    for (String h : cells) headers.add(h.replace("﻿", "").trim());
                    continue;
                }
                Map<String, String> row = new LinkedHashMap<>();
                for (int i = 0; i < headers.size(); i++) {
                    row.put(headers.get(i), i < cells.length ? cells[i] : "");
                }
                rows.add(row);
            }
        }
        if (headers == null || rows.isEmpty()) {
            System.err.println("Test data file has no data rows: " + file.getPath());
            return null;
        }
        System.out.println("Test data: " + rows.size() + " row(s), columns " + headers + ", mode " + mode);
        return new TestDataProvider(Collections.unmodifiableList(headers), rows, mode);
    }

    /** One data row with its 1-based number, or null when "unique" data is used up. */
    public DataRow next() {
        int index;
        if (mode.equals("random")) {
            index = ThreadLocalRandom.current().nextInt(rows.size());
        } else {
            int n = cursor.getAndIncrement();
            if (mode.equals("unique") && n >= rows.size()) return null;
            index = Math.floorMod(n, rows.size());
        }
        return new DataRow(index + 1, rows.get(index));
    }

    /** Every row once, in file order (used when the run has no duration: one iteration per row). */
    public List<DataRow> allRows() {
        List<DataRow> out = new ArrayList<>(rows.size());
        for (int i = 0; i < rows.size(); i++) out.add(new DataRow(i + 1, rows.get(i)));
        return out;
    }

    public List<String> getHeaders() {
        return headers;
    }

    /** A data row bound to one flow iteration. */
    public static class DataRow {
        public final int number;
        public final Map<String, String> values;

        DataRow(int number, Map<String, String> values) {
            this.number = number;
            this.values = values;
        }

        /** Replace ${column} in every field of a step; unknown placeholders are left as-is. */
        public Map<String, String> apply(Map<String, String> step) {
            Map<String, String> out = new HashMap<>(step.size());
            for (Map.Entry<String, String> e : step.entrySet()) {
                out.put(e.getKey(), substitute(e.getValue()));
            }
            return out;
        }

        String substitute(String value) {
            if (value == null || value.indexOf("${") < 0) return value;
            Matcher m = PLACEHOLDER.matcher(value);
            StringBuffer sb = new StringBuffer();
            while (m.find()) {
                String replacement = values.containsKey(m.group(1)) ? values.get(m.group(1)) : m.group(0);
                m.appendReplacement(sb, Matcher.quoteReplacement(replacement));
            }
            m.appendTail(sb);
            return sb.toString();
        }
    }
}
