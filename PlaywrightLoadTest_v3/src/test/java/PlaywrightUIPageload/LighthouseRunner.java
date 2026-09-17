package PlaywrightUIPageload;

import org.json.JSONObject;
import java.io.*;
import java.util.List;
import java.util.Map;
import java.util.Properties;

public class LighthouseRunner {

    public static void runLighthouseForUrls(List<Map<String, String>> testCasesList, String resultFilename, Properties properties) {
        try {
            FileWriter csvWriter = new FileWriter(resultFilename);

            // Write CSV header
            csvWriter.append("URL,FCP,LCP,TBT,CLS,SpeedIndex,PerformanceScore\n");

            for (Map<String, String> testCase : testCasesList) {
                String pageUrl = testCase.get("Page Path Url");

                System.out.println("Running Lighthouse for URL: " + pageUrl);

                // Generate Lighthouse report
                String lighthouseResultFilename = resultFilename + "." + pageUrl.hashCode() + ".lighthouse.json"; // Unique filename for each URL
                generateLighthouseReport(pageUrl, lighthouseResultFilename);

                // Parse Lighthouse report and write to CSV
                parseLighthouseReport(lighthouseResultFilename, csvWriter, pageUrl);

                // Delete the temporary Lighthouse JSON report file
                File lighthouseFile = new File(lighthouseResultFilename);
                if (lighthouseFile.exists()) {
                    lighthouseFile.delete();
                }
            }

            csvWriter.close();
            System.out.println("Lighthouse reports written to: " + resultFilename);
        } catch (IOException e) {
            System.err.println("Exception occurred while running Lighthouse for URLs: " + e.getMessage());
            e.printStackTrace();
        }
    }

    private static void generateLighthouseReport(String pageUrl, String resultFilename) {
        try {
            // Full path to the Lighthouse CLI executable script
            String lighthousePath = "C:\\Users\\SanatanJha\\AppData\\Roaming\\npm\\node_modules\\lighthouse\\cli\\index.js"; // Update this path as needed

            // Command to run Lighthouse via node
            String[] command = {"node", lighthousePath, pageUrl, "--output=json", "--output-path=" + resultFilename};

            // Execute the command
            ProcessBuilder processBuilder = new ProcessBuilder(command);
            processBuilder.redirectErrorStream(true);
            Process process = processBuilder.start();

            // Read the output of the command
            BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()));
            String line;
            while ((line = reader.readLine()) != null) {
                System.out.println(line);
            }

            // Wait for the process to complete
            int exitCode = process.waitFor();
            if (exitCode == 0) {
                System.out.println("Lighthouse report generated successfully for URL: " + pageUrl);
            } else {
                System.err.println("Failed to generate Lighthouse report for URL: " + pageUrl);
            }
        } catch (Exception e) {
            System.err.println("Exception occurred while generating Lighthouse report: " + e.getMessage());
            e.printStackTrace();
        }
    }

    private static void parseLighthouseReport(String lighthouseResultFilename, FileWriter csvWriter, String pageUrl) {
        try {
            BufferedReader reader = new BufferedReader(new FileReader(lighthouseResultFilename));
            StringBuilder jsonContent = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                jsonContent.append(line);
            }
            reader.close();

            JSONObject jsonObject = new JSONObject(jsonContent.toString());

            double fcp = jsonObject.getJSONObject("audits").getJSONObject("first-contentful-paint").getDouble("numericValue");
            double lcp = jsonObject.getJSONObject("audits").getJSONObject("largest-contentful-paint").getDouble("numericValue");
            double tbt = jsonObject.getJSONObject("audits").getJSONObject("total-blocking-time").getDouble("numericValue");
            double cls = jsonObject.getJSONObject("audits").getJSONObject("cumulative-layout-shift").getDouble("numericValue");
            double speedIndex = jsonObject.getJSONObject("audits").getJSONObject("speed-index").getDouble("numericValue");
            double performanceScore = jsonObject.getJSONObject("categories").getJSONObject("performance").getDouble("score");

            csvWriter.append(pageUrl).append(',')
                    .append(String.valueOf(fcp)).append(',')
                    .append(String.valueOf(lcp)).append(',')
                    .append(String.valueOf(tbt)).append(',')
                    .append(String.valueOf(cls)).append(',')
                    .append(String.valueOf(speedIndex)).append(',')
                    .append(String.valueOf(performanceScore)).append('\n');
            csvWriter.flush();
        } catch (Exception e) {
            System.err.println("Exception occurred while parsing Lighthouse report: " + e.getMessage());
            e.printStackTrace();
        }
    }
}
