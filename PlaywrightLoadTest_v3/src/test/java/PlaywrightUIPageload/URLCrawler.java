package PlaywrightUIPageload;

import org.jsoup.Connection;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;

import javax.net.ssl.*;
import java.security.cert.X509Certificate;
import java.io.*;
import java.util.HashSet;
import java.util.Properties;
import java.util.Set;

public class URLCrawler {

    // Set to keep track of visited URLs
    private Set<String> visitedUrls = new HashSet<>();
    private String domain;
    static String runId = RunIdManager.getRunId();

    public URLCrawler(String domain) {
        this.domain = domain;
    }

    public void crawl(String url) {
        try {
            if (shouldSkipUrl(url)) {
                System.out.println("Skipping URL: " + url);
                return;
            }

            Properties properties = loadProperties(Main.getPropertiesFilePath());
            String resultDirectory = properties.getProperty("ResultDirectory");
            if (resultDirectory == null) {
                System.err.println("Result Directory property is missing or invalid.");
                return;
            }

            System.out.println("Crawling URL: " + url);
            visitedUrls.add(url);  // Mark this URL as visited

            // Send the request and check for HTTP status
            Connection.Response response = Jsoup.connect(url)
                    .userAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36")
                    .referrer("https://www.google.com")
                    .execute();

            if (response.statusCode() == 404) {
                System.out.println("Skipping URL due to 404 status: " + url);
                return;
            } else if (response.statusCode() == 403) {
                System.out.println("Access denied (403) for URL: " + url);
                return;
            }

            Document doc = response.parse();
            Elements links = doc.select("a[href]");

            // Ensure only one crawled file is created per execution
            String csvFilePath = resultDirectory + File.separator + "crawled_urls_" + runId + ".csv";
            File csvFile = new File(csvFilePath);
            boolean isNewFile = csvFile.createNewFile();

            try (FileWriter csvWriter = new FileWriter(csvFile, true)) {
                // Add headers if the file is new
                if (isNewFile) {
                    csvWriter.append("Transaction Name,Path Page URL,Element Identifier,Element Selector\n");
                    System.out.println("Headers added to the new CSV file.");
                }

                for (Element link : links) {
                    String absUrl = link.absUrl("href");

                    // Check if the URL is valid and hasn't been visited
                    if (!absUrl.isEmpty() && !shouldSkipUrl(absUrl) && !visitedUrls.contains(absUrl)) {
                        System.out.println("Processing link: " + absUrl);
                        visitedUrls.add(absUrl); // Mark the URL as visited

                        // Generate Transaction Name
                        String transactionName = generateTransactionName(absUrl);

                        // Write to CSV
                        csvWriter.append(transactionName)
                        .append(',')
                        .append(absUrl)
                        .append(',') // Element Identifier
                        .append(',') // Element Selector
                        .append("\n");


                        // Recursively crawl this link
                        crawl(absUrl);
                    }
                }
                csvWriter.flush(); // Ensure the data is written to the file
            }

            // After writing the crawled file, update the testCaseFiles property
            updatePropertiesFile(csvFilePath);

        } catch (IOException e) {
            System.err.println("Failed to connect to URL: " + url);
            e.printStackTrace();
        } catch (Exception e) {
            System.err.println("An error occurred while processing URL: " + url);
            e.printStackTrace();
        }
    }

    private boolean shouldSkipUrl(String url) {
        return visitedUrls.contains(url) || !url.startsWith(domain);
    }

    private String generateTransactionName(String url) {
        String path = url.replaceFirst("https?://[^/]+/", ""); // Remove protocol and domain
        return !path.isEmpty() ? path : "Landing_Pages";
    }

    private Properties loadProperties(String filePath) throws IOException {
        Properties properties = new Properties();
        File file = new File(filePath);
        if (!file.exists()) {
            System.err.println("Properties file does not exist: " + filePath);
            throw new IOException("Properties file not found.");
        }
        try (FileInputStream input = new FileInputStream(filePath)) {
            properties.load(input);
        }
        return properties;
    }

    private void updatePropertiesFile(String crawledFilePath) throws IOException {
        Properties properties = loadProperties(Main.getPropertiesFilePath());
        properties.setProperty("testCaseFiles", new File(crawledFilePath).getAbsolutePath());
        try (FileOutputStream output = new FileOutputStream(Main.getPropertiesFilePath())) {
            properties.store(output, "Updated testCaseFiles with the latest crawled file path");
        }
    }

    static void disableSSLCertificateValidation() {
        try {
            TrustManager[] trustAllCerts = new TrustManager[] {
                new X509TrustManager() {
                    public X509Certificate[] getAcceptedIssuers() {
                        return null;
                    }

                    public void checkClientTrusted(X509Certificate[] certs, String authType) {}

                    public void checkServerTrusted(X509Certificate[] certs, String authType) {}
                }
            };

            SSLContext sc = SSLContext.getInstance("SSL");
            sc.init(null, trustAllCerts, new java.security.SecureRandom());
            HttpsURLConnection.setDefaultSSLSocketFactory(sc.getSocketFactory());

            HostnameVerifier allHostsValid = (hostname, session) -> true;
            HttpsURLConnection.setDefaultHostnameVerifier(allHostsValid);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }}