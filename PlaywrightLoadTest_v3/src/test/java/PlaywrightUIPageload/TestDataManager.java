package PlaywrightUIPageload;

import java.io.BufferedReader;
import java.io.FileReader;
import java.io.IOException;
import java.util.*;

public class TestDataManager {

    public static List<Map<String, String>> readTestCasesFromCSV(String testCasesFilename) {
        List<Map<String, String>> testCasesData = new ArrayList<>();

        try (BufferedReader br = new BufferedReader(new FileReader(testCasesFilename))) {
            String line;
            String[] headers = null;

            while ((line = br.readLine()) != null) {
                if (line.trim().isEmpty()) {
                    continue; // Skip empty lines
                }

                if (headers == null) {
                    headers = splitCsvLine(line);
                    // Trim headers to remove any leading/trailing spaces
                    for (int i = 0; i < headers.length; i++) {
                        headers[i] = headers[i].trim();
                    }
                } else {
                    String[] parts = splitCsvLine(line);
                    Map<String, String> rowData = new HashMap<>();

                    // Ensure that the number of parts matches the number of headers
                    int length = Math.min(headers.length, parts.length);
                    for (int i = 0; i < length; i++) {
                        rowData.put(headers[i], parts[i].trim());
                    }

                    // Handle extra headers if there are fewer parts
                    for (int i = length; i < headers.length; i++) {
                        rowData.put(headers[i], ""); // or handle differently based on requirements
                    }

                    testCasesData.add(rowData);
                }
            }
        } catch (IOException e) {
            e.printStackTrace();
        }

        return testCasesData;
    }

    /**
     * Split one CSV line, honouring double-quoted fields ("a,b" and "" escapes) so selectors
     * containing commas or quotes survive. Unquoted lines split exactly as on ",".
     */
    public static String[] splitCsvLine(String line) {
        List<String> fields = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        boolean inQuotes = false;
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (inQuotes) {
                if (c == '"') {
                    if (i + 1 < line.length() && line.charAt(i + 1) == '"') {
                        cur.append('"');
                        i++;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    cur.append(c);
                }
            } else if (c == '"' && cur.toString().trim().isEmpty()) {
                cur.setLength(0);
                inQuotes = true;
            } else if (c == ',') {
                fields.add(cur.toString());
                cur.setLength(0);
            } else {
                cur.append(c);
            }
        }
        fields.add(cur.toString());
        return fields.toArray(new String[0]);
    }
}
