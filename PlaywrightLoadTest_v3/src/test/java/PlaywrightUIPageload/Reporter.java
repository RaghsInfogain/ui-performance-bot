package PlaywrightUIPageload;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;

public class Reporter {

    private static BufferedWriter writer;
    static String resultDirectory;
    static String runId = RunIdManager.getRunId();

    static String csvDirectory;

    // Initialize the reporter with the result directory
    public static void initialize(String resultDirectory) {
        try {
            csvDirectory = resultDirectory;
            Reporter.resultDirectory = resultDirectory + File.separator + "Scripted_Flow_" + "Run_ID" + runId;

            // Create the directory if it doesn't exist
            File directory = new File(resultDirectory);
            if (!directory.exists()) {
                directory.mkdirs(); // This will create the directory and any necessary parent directories
            }

            // Define the result file path
            String resultFilePath = resultDirectory + File.separator + "ScriptedFlow_Test_" + runId + "_Results.csv";
            File resultFile = new File(resultFilePath);
            boolean fileExists = resultFile.exists();

            // Print the file path for debugging purposes
            System.out.println("Result file path: " + resultFilePath);

            // Open the file in append mode
            writer = new BufferedWriter(new FileWriter(resultFile, true));

            // Write the header if the file is newly created
            if (!fileExists) {
                writer.write("Run_ID,Timestamp,Transaction,HostName,Test Step Name,Request,Waiting Element,Waiting Element Load Time,Playwirght Page Load Time,Test Status,Failure Reason,Page Load Time,Network Time,DNS Lookup Time,Connection Time,Server Processing Time,Response Time,Browser Time,DOM Interaction Time,DOM Complete Time,First Contentful Paint,Last Contentful Paint,Total Blocking Time,Cumulative Layout Shift,Speed Index,Performance Score\n");
            }

        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    // Log the result for each test execution step
    public static void logResult(String runId, String timestamp, String hostname, String transactionName, String testStepName, String request, String elementIdentifier, String loadTime, String fullPageLoadTime, String testStatus, String failureReason, String pageLoadTimeCalculated, String networkTime, String dnsLookupTime, String connectionTime, String serverProcessingTime, String responseTime, String browserTime, String domInteractionTime, String domCompleteTime, String fcp, String lcp, String tbt, String cls, String speedIndex, String performanceScore) {
        try {
            // Debug log to ensure values are being passed correctly
            System.out.println("Logging result with Run ID: " + runId + " and timestamp: " + timestamp);
            System.out.println("Transaction: " + transactionName + ", Test Status: " + testStatus);

            // Format the data and write it to the CSV
            // Columns: Run_ID,Timestamp,Transaction,HostName,...
            String formattedString = String.format("%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n",
                    "Run_ID" + runId, timestamp, transactionName, hostname, testStepName, request, elementIdentifier, loadTime,
                    fullPageLoadTime, testStatus, failureReason, pageLoadTimeCalculated, networkTime, dnsLookupTime, connectionTime,
                    serverProcessingTime, responseTime, browserTime, domInteractionTime, domCompleteTime, fcp, lcp, tbt, cls, speedIndex, performanceScore);

            // Write the formatted data to the CSV file
            writer.write(formattedString);
            writer.flush();
            long loadMs = 0;
            try {
                if (loadTime != null && !loadTime.isEmpty()) loadMs = Long.parseLong(loadTime);
            } catch (NumberFormatException ignored) {
            }
            double score = 0;
            try {
                if (performanceScore != null && !performanceScore.isEmpty()) score = Double.parseDouble(performanceScore);
            } catch (NumberFormatException ignored) {
            }
            String pageUrl = (request != null && !request.isEmpty()) ? request : (testStepName != null ? testStepName : transactionName);
            RunProgressRecorder.record(
                    csvDirectory != null ? csvDirectory : resultDirectory,
                    pageUrl,
                    transactionName,
                    loadMs,
                    loadTime,
                    testStatus,
                    failureReason,
                    score
            );

        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    // Log additional information to a text log
    public static void logText(String testStepName, String text) {
        try {
            String logFilePath = resultDirectory + File.separator + "ScriptedFlow_Text_Log.txt";
            BufferedWriter logWriter = new BufferedWriter(new FileWriter(logFilePath, true));
            logWriter.write("Test Step: " + testStepName + " - Text: " + text + "\n");
            logWriter.close();
        } catch (IOException e) {
            e.printStackTrace();
            System.err.println("Failed to log text: " + e.getMessage());
        }
    }

    // Finalize the report, ensuring all data is written and the file is closed
    public static void finalizeReport() {
        try {
            if (writer != null) {
                // Flush the writer to ensure data is written to the file
                writer.flush();
                writer.close();
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
    }
}


