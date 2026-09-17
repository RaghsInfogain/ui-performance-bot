package PlaywrightUIPageload;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.Date;

public class ResultReporter {
	static String runId = RunIdManager.getRunId();

    public static void writeTestResultToCSV(Date timestamp, String transactionName, String pageUrl, long fullPageLoadTime, String elementLoadTime, String runId, String testStatus, String resultFilename, String hostname) {
        try {
            boolean isNewFile = !new File(resultFilename).exists();
            FileWriter csvWriter = new FileWriter(resultFilename, true);

            // Add headers if the file is new
            if (isNewFile) {
                csvWriter.append("Run ID,Timestamp,Transaction Name,Page URL,Full Page Load Time,Element Load Time,Test Status\n");
            }

            String formattedTimestamp = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(timestamp);

            // Append results to CSV
            csvWriter.append("Run_ID_").append(runId).append(',')
            		.append(formattedTimestamp).append(',')
                    .append(transactionName).append(',')
                    .append(pageUrl).append(',')
                    .append(String.valueOf(fullPageLoadTime)).append(',')
                    .append(elementLoadTime).append(',')
                    .append(String.valueOf(testStatus)).append('\n');

            csvWriter.flush();
            csvWriter.close();

            System.out.println("Test result saved to CSV for transaction: " + transactionName);
        } catch (IOException e) {
            System.err.println("Exception occurred while writing test result to CSV: " + e.getMessage());
            e.printStackTrace();
        }
    }
}
