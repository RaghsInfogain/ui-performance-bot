package PlaywrightUIPageload;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;

public class RunIdManager {

    private static final String RUN_ID_FILE = "runId.txt";
    private static String currentRunId = null;

    // Method to get the Run ID, generating it only once per test run
    public static String getRunId() {
        if (currentRunId == null) {
            currentRunId = loadAndIncrementRunId();
        }
        return currentRunId;
    }

    // Method to load the Run ID from the file and increment it for the next run
    private static String loadAndIncrementRunId() {
        String runId = "0001";  // Default runId
        try (BufferedReader reader = new BufferedReader(new FileReader(RUN_ID_FILE))) {
            runId = reader.readLine();
            if (runId != null) {
                int nextRunId = Integer.parseInt(runId) + 1;
                runId = String.format("%04d", nextRunId);
            }
        } catch (IOException e) {
            // Handle the exception if the file doesn't exist or can't be read
        }
        saveRunId(runId);
        return runId;
    }

    // Method to save the incremented Run ID back to the file
    private static void saveRunId(String runId) {
        try (BufferedWriter writer = new BufferedWriter(new FileWriter(RUN_ID_FILE))) {
            writer.write(runId);
        } catch (IOException e) {
            // Handle the exception if the file can't be written
        }
    }
}

