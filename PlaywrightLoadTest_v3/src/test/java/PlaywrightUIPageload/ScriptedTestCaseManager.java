package PlaywrightUIPageload;

import java.io.BufferedReader;
import java.io.FileReader;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class ScriptedTestCaseManager {

    public static List<Map<String, String>> readScriptedTestCasesFromCSV(String filePath) {
        List<Map<String, String>> testCasesList = new ArrayList<>();
        try (BufferedReader br = new BufferedReader(new FileReader(filePath))) {
            String line;
            String[] headers = null;
            while ((line = br.readLine()) != null) {
                if (line.trim().isEmpty()) {
                    continue; // Skip empty lines
                }
                if (headers == null) {
                    headers = TestDataManager.splitCsvLine(line);
                } else {
                    String[] parts = TestDataManager.splitCsvLine(line);
                    Map<String, String> testCase = new HashMap<>();
                    for (int i = 0; i < headers.length; i++) {
                        String value = parts.length > i ? parts[i].trim() : ""; // Handle empty cells gracefully
                        testCase.put(headers[i].trim(), value);
                    }
                    testCasesList.add(testCase);
                }
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
        return testCasesList;
    }
}
