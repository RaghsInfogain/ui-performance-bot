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
                    headers = line.split(",");
                    // Trim headers to remove any leading/trailing spaces
                    for (int i = 0; i < headers.length; i++) {
                        headers[i] = headers[i].trim();
                    }
                } else {
                    String[] parts = line.split(",");
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
}

