package PlaywrightUIPageload;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.net.MalformedURLException;
import java.net.URL;
import java.util.Map;
import java.util.Properties;

public class Main {

    public static String getPropertiesFilePath() {
        String relative = "src" + File.separator + "test" + File.separator + "resources" + File.separator + "Properties.properties";
        File fromCwd = new File(System.getProperty("user.dir"), relative);
        if (fromCwd.exists()) return fromCwd.getAbsolutePath();
        File fromParent = new File(System.getProperty("user.dir") + File.separator + "..", "PlaywrightLoadTest_v3" + File.separator + relative);
        return fromParent.exists() ? fromParent.getAbsolutePath() : fromCwd.getAbsolutePath();
    }

    public static void main(String[] args) {
        new Main().run();
    }

    public void run() {
        try {
            String propertiesPath = getPropertiesFilePath();
            Properties properties = loadProperties(propertiesPath);
            properties.list(System.out);

            String configFilePath = resolveConfigPath(propertiesPath, properties);
            if (configFilePath == null) {
                System.err.println("configFilePath property is missing or invalid.");
                return;
            }

            Map<String, String> config = ConfigurationManager.readConfigFromCSV(configFilePath);
            if (config == null || config.isEmpty()) {
                System.err.println("Configuration is missing or invalid.");
                return;
            }

            boolean isAutoCrawlEnabled = ConfigHelper.parseBool(config.get("AutoCrawl"));
            boolean isScriptedFlow = ConfigHelper.parseBool(config.get("ScriptedFlow"));
            boolean isUserExperienceEnabled = ConfigHelper.parseBool(config.get("UserExperience"));

            System.out.println("Auto Crawl: " + isAutoCrawlEnabled);
            System.out.println("Scripted Flow: " + isScriptedFlow);
            System.out.println("User Experience: " + isUserExperienceEnabled);
            System.out.println("Browser: " + config.getOrDefault("BrowserType", "chrome")
                    + ", Headless: " + ConfigHelper.isHeadless(config)
                    + ", Threads: " + ConfigHelper.getMultiThreading(config)
                    + ", Duration: " + (ConfigHelper.getTestDurationSeconds(config) >= 0
                    ? ConfigHelper.getTestDurationSeconds(config) + "s" : "unlimited")
                    + ", Think-Time: " + ConfigHelper.getThinkTimeMs(config) + "ms");

            if (isAutoCrawlEnabled && !isScriptedFlow) {
                String configUrl = config.get("CrawlerURL");
                if (configUrl == null || !isValidURL(configUrl)) {
                    System.err.println("Invalid or missing CrawlerURL.");
                    return;
                }
                try {
                    URL url = new URL(configUrl);
                    String domain = url.getProtocol() + "://" + url.getHost();
                    System.out.println("Starting crawl for domain: " + domain);
                    URLCrawler crawler = new URLCrawler(domain);
                    URLCrawler.disableSSLCertificateValidation();
                    crawler.crawl(configUrl);
                    System.out.println("Crawl completed.");
                    properties = loadProperties(propertiesPath);
                } catch (MalformedURLException e) {
                    System.err.println("Invalid URL format: " + configUrl);
                    e.printStackTrace();
                    return;
                } catch (IOException e) {
                    System.err.println("Error during crawl.");
                    e.printStackTrace();
                    return;
                }
            }

            if (isScriptedFlow) {
                System.out.println("Executing scripted framework tests...");
                ScriptedTestExecutor.executeTests(properties);
            } else if (isUserExperienceEnabled) {
                System.out.println("Executing static / user experience tests...");
                TestExecutor.executeTests(properties);
            } else {
                System.out.println("Scripted flow and User Experience are both disabled. Exiting.");
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    public Properties loadProperties(String filePath) throws IOException {
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

    public boolean isValidURL(String urlString) {
        try {
            new URL(urlString);
            return true;
        } catch (MalformedURLException e) {
            return false;
        }
    }

    private String resolveConfigPath(String propertiesPath, Properties properties) {
        String path = properties.getProperty("configFilePath");
        if (path == null || path.trim().isEmpty()) return null;
        File direct = new File(path);
        if (direct.exists()) return direct.getAbsolutePath();
        File propsDir = new File(propertiesPath).getParentFile();
        if (propsDir != null) {
            File relativeToProps = new File(propsDir, path);
            if (relativeToProps.exists()) return relativeToProps.getAbsolutePath();
        }
        File fromCwd = new File(System.getProperty("user.dir"), path);
        if (fromCwd.exists()) return fromCwd.getAbsolutePath();
        File fromParent = new File(System.getProperty("user.dir") + File.separator + "..", path.replaceFirst("^\\.\\./", ""));
        if (fromParent.exists()) return fromParent.getAbsolutePath();
        return path;
    }
}
