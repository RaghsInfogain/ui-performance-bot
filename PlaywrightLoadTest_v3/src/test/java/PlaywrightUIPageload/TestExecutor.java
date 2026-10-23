package PlaywrightUIPageload;

import com.microsoft.playwright.*;
import com.microsoft.playwright.options.LoadState;
import org.json.JSONObject;
import java.io.*;
import java.net.InetAddress;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.*;

public class TestExecutor {

    static String runId = RunIdManager.getRunId();

    /** Max concurrent Lighthouse CLI processes (each spawns its own Chrome). */
    private static final int MAX_LIGHTHOUSE_SLOTS = 32;

    public static void executeTests(Properties properties) {
        try {
            System.out.println("............................[Test Execution Started].....................................");

            String configFilePath = resolveConfigPath(properties);
            if (configFilePath == null) {
                throw new IllegalArgumentException("configFilePath property is missing.");
            }

            Map<String, String> config = ConfigurationManager.readConfigFromCSV(configFilePath);
            if (config == null || config.isEmpty()) {
                throw new IllegalArgumentException("Configuration is invalid.");
            }

            final double testDurationSeconds = ConfigHelper.getTestDurationSeconds(config);
            final boolean durationMode = testDurationSeconds >= 0;
            final boolean runUEM = ConfigHelper.parseBool(config.get("UserExperience"));
            final int numThreads = ConfigHelper.getMultiThreading(config);

            System.out.println("Browser: " + config.getOrDefault("BrowserType", "chrome")
                    + ", Headless: " + ConfigHelper.isHeadless(config)
                    + ", Threads: " + numThreads
                    + ", Duration: " + (durationMode ? testDurationSeconds + "s" : "unlimited")
                    + ", Think-Time: " + ConfigHelper.getThinkTimeMs(config) + "ms");

            String resultDirectory = properties.getProperty("ResultDirectory") + File.separator + "Static_RunID_" + runId;
            File resultDir = new File(resultDirectory);
            if (!resultDir.exists()) {
                resultDir.mkdirs();
            }

            String timestamp = new SimpleDateFormat("yyyyMMddHHmmss").format(new Date());
            String UEMResultFilename = resultDirectory + File.separator + "Static_Run_Report_RunID_" + runId + ".csv";

            String testCaseFilesProperty = resolveTestCaseFiles(properties, config);
            if (testCaseFilesProperty == null) {
                return;
            }

            List<String> testCaseFiles = Arrays.asList(testCaseFilesProperty.split(","));
            List<UrlWorkItem> allWork = buildWorkItems(testCaseFiles);
            if (allWork.isEmpty()) {
                System.err.println("No URLs found in test case files.");
                return;
            }

            final ExecutionGovernor governor = ExecutionGovernor.create(resultDirectory, testDurationSeconds);
            final ParallelWorkQueue<UrlWorkItem> workQueue = new ParallelWorkQueue<>(allWork, durationMode);
            final int lighthouseSlots = Math.min(numThreads, MAX_LIGHTHOUSE_SLOTS);
            final Semaphore lighthouseSemaphore = new Semaphore(lighthouseSlots);

            ThreadPoolExecutor executorService = new ThreadPoolExecutor(
                    numThreads, numThreads,
                    0L, TimeUnit.MILLISECONDS,
                    new LinkedBlockingQueue<>(),
                    r -> {
                        Thread t = new Thread(r);
                        t.setName("perf-worker");
                        return t;
                    });
            executorService.prestartAllCoreThreads();

            System.out.println("Multi-threaded execution: " + numThreads + " parallel browsers (one per worker), "
                    + lighthouseSlots + " concurrent Lighthouse slots");

            CountDownLatch browsersReady = new CountDownLatch(numThreads);
            List<Future<?>> futures = new ArrayList<>();

            for (int t = 0; t < numThreads; t++) {
                final int workerId = t + 1;
                futures.add(executorService.submit(() -> {
                    Thread.currentThread().setName("perf-worker-" + workerId);
                    try (Playwright playwright = Playwright.create()) {
                        Browser browser = BrowserManager.launchBrowser(config, playwright, workerId);
                        browsersReady.countDown();
                        System.out.println("[Worker " + workerId + "] Ready — claiming URLs from shared queue");
                        try {
                            while (governor.shouldAcceptNewWork()) {
                                UrlWorkItem item = workQueue.claimNext();
                                if (item == null) {
                                    break;
                                }

                                String pageUrl = item.pageUrl;
                                String elementSelector = item.testCase.get("Element Selector");
                                System.out.println("[Worker " + workerId + "] Testing URL: " + pageUrl);

                                governor.workStarted();
                                try {
                                    if (runUEM) {
                                        runUEM(pageUrl, resultDirectory, browser, UEMResultFilename, timestamp,
                                                item.testCase.get("Transaction Name"), config, elementSelector,
                                                lighthouseSemaphore);
                                    } else {
                                        navigateAndMeasure(browser, pageUrl, elementSelector, item.testCaseFile,
                                                item.testCase, config, properties, timestamp);
                                    }
                                } finally {
                                    governor.workFinished();
                                }

                                if (!governor.shouldAcceptNewWork()) {
                                    break;
                                }
                                ConfigHelper.sleepThinkTime(config);
                            }
                        } finally {
                            browser.close();
                            System.out.println("[Worker " + workerId + "] Browser closed");
                        }
                    } catch (Exception e) {
                        browsersReady.countDown();
                        System.err.println("[Worker " + workerId + "] Exception: " + e.getMessage());
                        e.printStackTrace();
                    }
                }));
            }

            try {
                browsersReady.await(120, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            System.out.println("All " + numThreads + " worker browsers launched.");
            governor.startDurationClock();

            for (Future<?> future : futures) {
                future.get();
            }

            governor.awaitInflightCompletion(300_000);

            executorService.shutdown();
            if (!executorService.awaitTermination(120, TimeUnit.SECONDS)) {
                executorService.shutdownNow();
            }

            System.out.println("Test execution completed.");
        } catch (IllegalArgumentException e) {
            System.err.println("Invalid argument: " + e.getMessage());
        } catch (Exception e) {
            System.err.println("Unexpected error: " + e.getMessage());
            e.printStackTrace();
        }
    }

    private static String resolveConfigPath(Properties properties) {
        String path = properties.getProperty("configFilePath");
        if (path == null || path.trim().isEmpty()) return null;
        File direct = new File(path);
        if (direct.exists()) return direct.getAbsolutePath();
        File fromCwd = new File(System.getProperty("user.dir"), path);
        if (fromCwd.exists()) return fromCwd.getAbsolutePath();
        File fromParent = new File(System.getProperty("user.dir") + File.separator + "..", path.replaceFirst("^\\.\\./", ""));
        if (fromParent.exists()) return fromParent.getAbsolutePath();
        return path;
    }

    private static String resolveTestCaseFiles(Properties properties, Map<String, String> config) {
        boolean autoCrawl = ConfigHelper.parseBool(config.get("AutoCrawl"));
        if (autoCrawl) {
            String testCaseFilesDirectory = properties.getProperty("ResultDirectory");
            File[] files = new File(testCaseFilesDirectory).listFiles(
                    (dir, name) -> name.startsWith("crawled_urls_") && name.endsWith(".csv"));
            if (files == null || files.length == 0) {
                throw new IllegalStateException("No crawled files found in directory: " + testCaseFilesDirectory);
            }
            File latestFile = Arrays.stream(files)
                    .max(Comparator.comparingLong(File::lastModified))
                    .orElseThrow(() -> new IllegalStateException("Failed to find the latest crawled file."));
            properties.setProperty("testCaseFiles", latestFile.getAbsolutePath());
            System.out.println("AutoCrawl Enabled. Using latest crawled file: " + latestFile.getAbsolutePath());
            return latestFile.getAbsolutePath();
        }

        String testCaseFilesProperty = properties.getProperty("UserExperienceTestCaseFilePath");
        if (testCaseFilesProperty == null || testCaseFilesProperty.isEmpty()) {
            System.err.println("UserExperienceTestCaseFilePath property is missing or invalid.");
            return null;
        }
        File userExperienceFile = new File(testCaseFilesProperty);
        if (!userExperienceFile.exists() || !userExperienceFile.isFile()) {
            System.err.println("Specified UserExperienceTestCaseFilePath does not exist: " + testCaseFilesProperty);
            return null;
        }
        System.out.println("Using test case file: " + testCaseFilesProperty);
        return testCaseFilesProperty;
    }

    private static List<UrlWorkItem> buildWorkItems(List<String> testCaseFiles) {
        List<UrlWorkItem> items = new ArrayList<>();
        for (String testCaseFile : testCaseFiles) {
            String trimmedFile = testCaseFile.trim();
            List<Map<String, String>> testCasesList = TestDataManager.readTestCasesFromCSV(trimmedFile);
            if (testCasesList == null) continue;
            for (Map<String, String> testCase : testCasesList) {
                String pagePathUrl = testCase.get("Path Page URL");
                if (pagePathUrl == null) continue;
                for (String pageUrl : pagePathUrl.split(",")) {
                    pageUrl = pageUrl.trim();
                    if (!pageUrl.isEmpty()) {
                        items.add(new UrlWorkItem(trimmedFile, testCase, pageUrl));
                    }
                }
            }
        }
        return items;
    }

    private static final class UrlWorkItem {
        final String testCaseFile;
        final Map<String, String> testCase;
        final String pageUrl;

        UrlWorkItem(String testCaseFile, Map<String, String> testCase, String pageUrl) {
            this.testCaseFile = testCaseFile;
            this.testCase = testCase;
            this.pageUrl = pageUrl;
        }
    }
	
    private static void navigateAndMeasure(Browser browser, String pageUrl, String elementSelector, String resultFilename, Map<String, String> testCase, Map<String, String> config, Properties properties, String runId) {
        Page page = null;
        try {
            page = browser.newPage();
            long startTime = System.currentTimeMillis();
            page.navigate(pageUrl);
            page.waitForLoadState(LoadState.LOAD);

            Integer fullPageLoadTime = (int) page.evaluate("window.performance.timing.loadEventEnd - window.performance.timing.navigationStart");

            String elementLoadTime = "N/A";
            if (elementSelector != null && !elementSelector.isEmpty()) {
                ElementHandle elementHandle = null;
                long timeout = System.currentTimeMillis() + 5000;
                while (System.currentTimeMillis() < timeout) {
                    try {
                        elementHandle = page.querySelector(Action.playwrightSelector(elementSelector));
                        if (elementHandle != null && elementHandle.isVisible()) {
                            long endTime = System.currentTimeMillis();
                            elementLoadTime = String.valueOf(endTime - startTime);
                            break;
                        }
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                }
            }

            String hostname = InetAddress.getLocalHost().getHostName();
            System.out.println("Element page load time for " + elementSelector + ": " + elementLoadTime);
            System.out.println("Page load time for " + pageUrl + ": " + fullPageLoadTime);

            ResultReporter.writeTestResultToCSV(new Date(), testCase.get("Transaction Name"), pageUrl, fullPageLoadTime, elementLoadTime, runId, (!elementLoadTime.equals("N/A") ? "PASS" : "FAIL"), resultFilename, hostname);

            if (ConfigHelper.parseBool(config.get("TakeScreenshot"))) {
                takeScreenshot(page, resultFilename, testCase.get("Transaction Name"), config, properties);
            }

        } catch (Exception e) {
            System.err.println("Exception occurred while navigating to URL: " + e.getMessage());
            e.printStackTrace();
        } finally {
            if (page != null) {
                page.close();
            }
        }
    }

    private static void runUEM(String pageUrl, String resultDirectory, Browser browser, String UEMResultFilename,
                             String runId, String transactionName, Map<String, String> config, String elementSelector,
                             Semaphore lighthouseSemaphore) {
        try {
            String captureTimestamp = new SimpleDateFormat("yyyyMMddHHmmss").format(new Date())
                    + "-" + Thread.currentThread().getId() + "-" + System.nanoTime();
            String jsonResultFilename = resultDirectory + File.separator + "Infogain_UEM_DataFile" + captureTimestamp + ".json";

            // Single Playwright navigation — results visible in UI within ~30–90s
            NavMeasurement nav = measurePageLoad(pageUrl, browser, elementSelector);
            TimingMetrics tm = computeTimingMetrics(nav.timing);
            if (nav.navigationOk) {
                saveNavTimingJson(resultDirectory, captureTimestamp, pageUrl, transactionName, nav.timing);
            }
            RunProgressRecorder.record(resultDirectory, pageUrl, transactionName, tm.pageLoadTime,
                    nav.elementLoadTime, nav.navigationOk ? "PASS" : "FAIL",
                    nav.navigationOk ? "" : "Playwright navigation failed", 0);

            // Write CSV immediately so the UI shows URLs within seconds (before Lighthouse finishes).
            writeUemResultPlaywrightOnly(UEMResultFilename, pageUrl, transactionName, nav, tm,
                    nav.navigationOk ? "" : "Playwright navigation failed");

            if (!nav.navigationOk) {
                return;
            }

            // Lighthouse audit (runs while other workers continue on different URLs)
            boolean lighthouseOk = generateUEMReport(pageUrl, jsonResultFilename, lighthouseSemaphore);

            File jsonFile = new File(jsonResultFilename);
            if (lighthouseOk && jsonFile.exists() && jsonFile.length() > 0) {
                writeUemResultFromLighthouse(UEMResultFilename, jsonResultFilename, pageUrl, transactionName, nav, tm);
            } else {
                System.err.println("Lighthouse skipped or failed for " + pageUrl + " — Playwright-only row retained.");
            }
        } catch (Exception e) {
            String failureReason = parseFailureReason(e);
            System.err.println("Failed to execute action 'UEM Run': " + failureReason);
            e.printStackTrace();
        }
    }

    private static boolean generateUEMReport(String pageUrl, String resultFilename, Semaphore lighthouseSemaphore) {
        boolean acquired = false;
        try {
            lighthouseSemaphore.acquire();
            acquired = true;

            String[] command = buildLighthouseCommand(pageUrl, resultFilename);
            System.out.println("Running Lighthouse: " + command[0] + " for " + pageUrl);

            ProcessBuilder processBuilder = new ProcessBuilder(command);
            processBuilder.redirectErrorStream(true);
            String npmCache = System.getenv("NPM_CONFIG_CACHE");
            if (npmCache != null && !npmCache.isEmpty()) {
                processBuilder.environment().put("NPM_CONFIG_CACHE", npmCache);
            }
            Process process = processBuilder.start();

            BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()));
            String line;
            while ((line = reader.readLine()) != null) {
                System.out.println(line);
            }

            int exitCode = process.waitFor();
            File out = new File(resultFilename);
            if (exitCode == 0 && out.exists() && out.length() > 0) {
                System.out.println("UEM_Data report generated successfully for URL: " + pageUrl);
                return true;
            }
            System.err.println("Failed to generate UEM_Data report for URL: " + pageUrl + " (exit " + exitCode + ")");
            return false;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            System.err.println("Lighthouse interrupted for URL: " + pageUrl);
            return false;
        } catch (Exception e) {
            String failureReason = parseFailureReason(e);
            System.err.println("Failed to execute action 'UEM_Data': " + failureReason);
            e.printStackTrace();
            return false;
        } finally {
            if (acquired) {
                lighthouseSemaphore.release();
            }
        }
    }

    private static String[] buildLighthouseCommand(String pageUrl, String resultFilename) {
        String chromeFlags = "--headless --no-sandbox --disable-gpu --disable-extensions --ignore-certificate-errors --disable-software-rasterizer";
        String lighthouseBin = resolveLighthouseExecutable();
        if (lighthouseBin != null) {
            return new String[]{
                    lighthouseBin,
                    pageUrl,
                    "--output=json",
                    "--output-path=" + resultFilename,
                    "--chrome-flags=" + chromeFlags,
                    "--only-categories=performance,accessibility,best-practices,seo",
                    "--emulated-form-factor=desktop",
                    "--disable-js-sampling",
                    "--skip-audits=total-idle-time"
            };
        }
        return new String[]{
                "npx",
                "--yes",
                "lighthouse",
                pageUrl,
                "--output=json",
                "--output-path=" + resultFilename,
                "--chrome-flags=" + chromeFlags,
                "--only-categories=performance,accessibility,best-practices,seo",
                "--emulated-form-factor=desktop",
                "--disable-js-sampling",
                "--skip-audits=total-idle-time"
        };
    }

    private static String resolveLighthouseExecutable() {
        String fromEnv = System.getenv("LIGHTHOUSE_BIN");
        if (fromEnv != null && !fromEnv.trim().isEmpty()) {
            File direct = new File(fromEnv.trim());
            if (direct.exists()) {
                return direct.getAbsolutePath();
            }
        }
        String binName = System.getProperty("os.name", "").toLowerCase().contains("win")
                ? "lighthouse.cmd" : "lighthouse";
        String[] candidates = {
                "../ui-performance-portal/node_modules/.bin/" + binName,
                "ui-performance-portal/node_modules/.bin/" + binName,
        };
        for (String candidate : candidates) {
            File fromCwd = new File(System.getProperty("user.dir"), candidate);
            if (fromCwd.exists()) {
                return fromCwd.getAbsolutePath();
            }
            File fromParent = new File(System.getProperty("user.dir") + File.separator + "..", candidate);
            if (fromParent.exists()) {
                return fromParent.getAbsolutePath();
            }
        }
        return null;
    }

    private static final class TimingMetrics {
        final long pageLoadTime;
        final long networkTime;
        final long dnsLookupTime;
        final long connectionTime;
        final long serverProcessingTime;
        final long responseTime;
        final long browserTime;
        final long domInteractionTime;
        final long domCompleteTime;

        TimingMetrics(long pageLoadTime, long networkTime, long dnsLookupTime, long connectionTime,
                      long serverProcessingTime, long responseTime, long browserTime,
                      long domInteractionTime, long domCompleteTime) {
            this.pageLoadTime = pageLoadTime;
            this.networkTime = networkTime;
            this.dnsLookupTime = dnsLookupTime;
            this.connectionTime = connectionTime;
            this.serverProcessingTime = serverProcessingTime;
            this.responseTime = responseTime;
            this.browserTime = browserTime;
            this.domInteractionTime = domInteractionTime;
            this.domCompleteTime = domCompleteTime;
        }
    }

    private static TimingMetrics computeTimingMetrics(JSONObject timing) {
        if (timing == null || timing.length() == 0) {
            return new TimingMetrics(0, 0, 0, 0, 0, 0, 0, 0, 0);
        }
        long navigationStart = timing.optLong("navigationStart", 0);
        long loadEventEnd = timing.optLong("loadEventEnd", navigationStart);
        long connectEnd = timing.optLong("connectEnd", navigationStart);
        long domainLookupStart = timing.optLong("domainLookupStart", navigationStart);
        long domainLookupEnd = timing.optLong("domainLookupEnd", domainLookupStart);
        long connectStart = timing.optLong("connectStart", domainLookupStart);
        long responseEnd = timing.optLong("responseEnd", navigationStart);
        long responseStart = timing.optLong("responseStart", navigationStart);
        long requestStart = timing.optLong("requestStart", navigationStart);
        long domLoading = timing.optLong("domLoading", navigationStart);
        long domInteractive = timing.optLong("domInteractive", domLoading);
        long domComplete = timing.optLong("domComplete", domLoading);

        return new TimingMetrics(
                Math.max(0, loadEventEnd - navigationStart),
                Math.max(0, connectEnd - domainLookupStart),
                Math.max(0, domainLookupEnd - domainLookupStart),
                Math.max(0, connectEnd - connectStart),
                Math.max(0, responseEnd - responseStart),
                Math.max(0, responseEnd - requestStart),
                Math.max(0, loadEventEnd - domLoading),
                Math.max(0, domInteractive - domLoading),
                Math.max(0, domComplete - domLoading));
    }

    private static NavMeasurement measurePageLoad(String pageUrl, Browser browser, String elementSelector) {
        Page page = null;
        try {
            page = browser.newPage();
            long startTime = System.currentTimeMillis();

            page.navigate(pageUrl, new Page.NavigateOptions().setTimeout(90000));
            page.waitForLoadState(LoadState.DOMCONTENTLOADED, new Page.WaitForLoadStateOptions().setTimeout(90000));

            // Wait for a load-confirming element (default body when CSV has blank/NA)
            String waitSelector = elementSelector;
            if (waitSelector == null || waitSelector.trim().isEmpty()
                    || "NA".equalsIgnoreCase(waitSelector.trim())
                    || "N/A".equalsIgnoreCase(waitSelector.trim())) {
                waitSelector = "body";
            }
            String elementLoadTime = "N/A";
            long timeout = System.currentTimeMillis() + 15000;
            while (System.currentTimeMillis() < timeout) {
                try {
                    ElementHandle elementHandle = page.querySelector(Action.playwrightSelector(waitSelector));
                    if (elementHandle != null && elementHandle.isVisible()) {
                        elementLoadTime = String.valueOf(System.currentTimeMillis() - startTime);
                        break;
                    }
                } catch (Exception ignored) {
                }
                try {
                    Thread.sleep(100);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
            if ("N/A".equals(elementLoadTime)) {
                // Fallback: document body confirms interactive document
                try {
                    page.waitForSelector("body",
                            new Page.WaitForSelectorOptions()
                                    .setState(com.microsoft.playwright.options.WaitForSelectorState.VISIBLE)
                                    .setTimeout(5000));
                    elementLoadTime = String.valueOf(System.currentTimeMillis() - startTime);
                } catch (Exception ignored) {
                }
            }

            String timingJson = (String) page.evaluate("() => { const t = window.performance.timing; return JSON.stringify({ navigationStart: t.navigationStart, domainLookupStart: t.domainLookupStart, domainLookupEnd: t.domainLookupEnd, connectStart: t.connectStart, connectEnd: t.connectEnd, requestStart: t.requestStart, responseStart: t.responseStart, responseEnd: t.responseEnd, domLoading: t.domLoading, domInteractive: t.domInteractive, domContentLoadedEventStart: t.domContentLoadedEventStart, domContentLoadedEventEnd: t.domContentLoadedEventEnd, domComplete: t.domComplete, loadEventStart: t.loadEventStart, loadEventEnd: t.loadEventEnd, fetchStart: t.fetchStart, secureConnectionStart: t.secureConnectionStart, redirectStart: t.redirectStart, redirectEnd: t.redirectEnd }); }");
            return new NavMeasurement(elementLoadTime, new JSONObject(timingJson), true);

        } catch (Exception e) {
            System.err.println("Error occurred while navigating to: " + pageUrl);
            System.err.println("Exception: " + e.getMessage());
            return NavMeasurement.failed();
        } finally {
            if (page != null) {
                page.close();
            }
        }
    }

    private static void writeUemResultFromLighthouse(String resultFilename, String lighthouseJsonPath,
                                                     String pageUrl, String transactionName,
                                                     NavMeasurement nav, TimingMetrics tm) {
        try {
            CsvResultWriter.ensureHeader(resultFilename);

            BufferedReader reader = new BufferedReader(new FileReader(lighthouseJsonPath));
            StringBuilder jsonContent = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                jsonContent.append(line);
            }
            reader.close();

            JSONObject jsonObject = new JSONObject(jsonContent.toString());
            long fcp = (long) jsonObject.getJSONObject("audits").getJSONObject("first-contentful-paint").getDouble("numericValue");
            long lcp = (long) jsonObject.getJSONObject("audits").getJSONObject("largest-contentful-paint").getDouble("numericValue");
            long tbt = (long) jsonObject.getJSONObject("audits").getJSONObject("total-blocking-time").getDouble("numericValue");
            double cls = jsonObject.getJSONObject("audits").getJSONObject("cumulative-layout-shift").getDouble("numericValue");
            long speedIndex = (long) jsonObject.getJSONObject("audits").getJSONObject("speed-index").getDouble("numericValue");
            double performanceScore = jsonObject.getJSONObject("categories").getJSONObject("performance").getDouble("score");

            String hostname = InetAddress.getLocalHost().getHostName();
            String status = nav.navigationOk ? "PASS" : "FAIL";
            String failureReason = nav.navigationOk ? "" : "Playwright navigation failed";

            CsvResultWriter.appendRow(resultFilename,
                    "Run_ID_" + RunIdManager.getRunId(),
                    getCurrentTimestamp(),
                    hostname,
                    transactionName != null ? transactionName : "",
                    pageUrl,
                    String.valueOf(fcp),
                    String.valueOf(lcp),
                    String.valueOf(tbt),
                    String.valueOf(cls),
                    String.valueOf(speedIndex),
                    String.valueOf(performanceScore),
                    String.valueOf(tm.pageLoadTime),
                    String.valueOf(tm.networkTime),
                    String.valueOf(tm.dnsLookupTime),
                    String.valueOf(tm.connectionTime),
                    String.valueOf(tm.serverProcessingTime),
                    String.valueOf(tm.responseTime),
                    String.valueOf(tm.browserTime),
                    String.valueOf(tm.domInteractionTime),
                    String.valueOf(tm.domCompleteTime),
                    String.valueOf(tm.pageLoadTime),
                    nav.elementLoadTime,
                    status,
                    failureReason,
                    "", "", "");

            RunProgressRecorder.record(new File(lighthouseJsonPath).getParent(), pageUrl, transactionName,
                    tm.pageLoadTime, nav.elementLoadTime, status, failureReason, performanceScore);

            System.out.println("CSV row saved for URL: " + pageUrl + " (score=" + performanceScore + ")");
        } catch (Exception e) {
            System.err.println("Failed to write Lighthouse CSV for " + pageUrl + ": " + e.getMessage());
        }
    }

    private static void writeUemResultPlaywrightOnly(String resultFilename, String pageUrl, String transactionName,
                                                     NavMeasurement nav, TimingMetrics tm, String failureReason) {
        try {
            CsvResultWriter.ensureHeader(resultFilename);
            String hostname = InetAddress.getLocalHost().getHostName();
            String status = nav.navigationOk ? "PASS" : "FAIL";

            CsvResultWriter.appendRow(resultFilename,
                    "Run_ID_" + RunIdManager.getRunId(),
                    getCurrentTimestamp(),
                    hostname,
                    transactionName != null ? transactionName : "",
                    pageUrl,
                    "0", "0", "0", "0", "0", "0",
                    String.valueOf(tm.pageLoadTime),
                    String.valueOf(tm.networkTime),
                    String.valueOf(tm.dnsLookupTime),
                    String.valueOf(tm.connectionTime),
                    String.valueOf(tm.serverProcessingTime),
                    String.valueOf(tm.responseTime),
                    String.valueOf(tm.browserTime),
                    String.valueOf(tm.domInteractionTime),
                    String.valueOf(tm.domCompleteTime),
                    String.valueOf(tm.pageLoadTime),
                    nav.elementLoadTime,
                    status,
                    failureReason != null ? failureReason : "",
                    "", "", "");

            System.out.println("CSV row saved (Playwright) for URL: " + pageUrl);
        } catch (Exception e) {
            System.err.println("Failed to write Playwright CSV for " + pageUrl + ": " + e.getMessage());
        }
    }

    private static void saveNavTimingJson(String resultDirectory, String captureTimestamp, String pageUrl, String transactionName, JSONObject milestones) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("pageUrl", pageUrl);
            payload.put("transaction", transactionName);
            payload.put("capturedAt", captureTimestamp);
            payload.put("milestones", milestones);
            String navPath = resultDirectory + File.separator + "NavTiming" + captureTimestamp + ".json";
            try (FileWriter writer = new FileWriter(navPath)) {
                writer.write(payload.toString(2));
            }
            System.out.println("Navigation timing saved: " + navPath);
        } catch (Exception e) {
            System.err.println("Failed to save navigation timing JSON: " + e.getMessage());
        }
    }

    private static String getCurrentTimestamp() {
        return new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date());
    }

    
    public static void InsertdataInDB(
    	    String runId2,
    	    String timestamp,
    	    String hostname,
    	    String transactionName,
    	    String pageUrl,
    	    long fcp,
    	    long lcp,
    	    long tbt,
    	    double cls,
    	    long speedIndex,
    	    double performanceScore,
    	    long pageLoadTime,
    	    long networkTime,
    	    long dnsLookupTime,
    	    long connectionTime,
    	    long serverProcessingTime,
    	    long responseTime,
    	    long browserTime,
    	    long domInteractionTime,
    	    long domCompleteTime,
    	    long playwrightPageLoadTime,
    	    String elementLoadTime,
    	    String testStatus
    	) throws SQLException {
    	
    	//jdbc:mysql://localhost:3310/mysql
    	//   String url = "jdbc:mysql://127.0.0.1:3306/your_database";  // Update with your database name
    	/*
    	 * create table ClientSide_Results (runId1 varchar(255), timestamp float, hostname varchar(255),
    	 *  transactionName varchar(255), pageUrl varchar(255),fcp float, lcp float, tbt float, cls double,
    	 *   speedIndex float, performanceScore double, pageLoadTime float, networkTime float,dnsLookupTime float,
    	 *    connectionTime float, serverProcessingTime float, responseTime float, browserTime float, domInteractionTime float,
    	 *     domCompleteTime float, playwrightPageLoadTime float, elementLoadTime varchar(255), testStatus varchar(255));
    	 * */
    		String url = "jdbc:mysql://localhost:3310/plywright";  // Update with your database name
    		String user = "root";
    	    String password = "";  // Update with your password
    	    String sql = "INSERT INTO testResults (run_id, timestamp, hostname, transaction_name, page_url, " +
                "fcp, lcp, tbt, cls, speed_index, performance_score, page_load_time, network_time, " +
                 "dns_lookup_time, connection_time, server_processing_time, response_time, browser_time, " +
               "dom_interaction_time, dom_complete_time, playwright_page_load_time, element_load_time, " +
                "test_status) " +
                 "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
    	    
    	    
    	    

    	    try (Connection con = DriverManager.getConnection(url, user, password);
    	         PreparedStatement statement = con.prepareStatement(sql)) {

    	        statement.setString(1, runId2);
    	        statement.setString(2, timestamp);
    	        statement.setString(3, hostname);
    	        statement.setString(4, transactionName);
    	        statement.setString(5, pageUrl);
    	        statement.setLong(6, fcp);
    	        statement.setLong(7, lcp);
    	        statement.setLong(8, tbt);
    	        statement.setDouble(9, cls);
    	        statement.setLong(10, speedIndex);
    	        statement.setDouble(11, performanceScore);
    	        statement.setLong(12, pageLoadTime);
    	        statement.setLong(13, networkTime);
    	        statement.setLong(14, dnsLookupTime);
    	        statement.setLong(15, connectionTime);
    	        statement.setLong(16, serverProcessingTime);
    	        statement.setLong(17, responseTime);
    	        statement.setLong(18, browserTime);
    	        statement.setLong(19, domInteractionTime);
    	        statement.setLong(20, domCompleteTime);
    	        statement.setLong(21, playwrightPageLoadTime);
    	        statement.setString(22, elementLoadTime);
    	        statement.setString(23, testStatus);

    	        statement.executeUpdate();
    	        System.out.println("Inserted data successfully");
    	    } catch (SQLException ex) {
    	        System.err.println("SQL Exception: " + ex.getMessage());
    	        ex.printStackTrace();
    	    }
 	}
    
    public static String parseFailureReason(Exception e) {
        String message = e.getMessage();

        if (message.contains("Timeout")) {
            return "Element not Found";
        }
        if (message.contains("DOMException")) {
            return "DOMException";
        }

        // Add more specific checks as needed
        else {
        // Default to the full message if no specific case matches
        return ("Some Error Ocurred while the execution"); // Split and take the first part before ':' or adjust as needed
    }}

    private static void takeScreenshot(Page page, String resultFilename, String transactionName, Map<String, String> config, Properties properties) {
        try {
            String screenshotDirectory = properties.getProperty("ScreenshotDirectory");
            if (ConfigHelper.parseBool(config.get("TakeScreenshot")) && screenshotDirectory != null && !screenshotDirectory.isEmpty()) {
                File directory = new File(screenshotDirectory);
                if (!directory.exists()) {
                    directory.mkdirs();
                }

                String screenshotFilename = screenshotDirectory + File.separator + transactionName + "_" + System.currentTimeMillis() + ".png";
                page.screenshot(new Page.ScreenshotOptions().setPath(Paths.get(screenshotFilename)));
                System.out.println("Screenshot saved: " + screenshotFilename);
            } else {
                System.out.println("Skipping screenshot for transaction: " + transactionName + " as TakeScreenshot is set to false in the configuration.");
            }
        } catch (Exception e) {
            System.err.println("Failed to take screenshot: " + e.getMessage());
            e.printStackTrace();
        }
    }

    public static Map<String, Object> getDiagnosticsFromJson(String jsonFilePath) {
        Map<String, Object> diagnostics = new HashMap<>();
        try {
            // Read the contents of the JSON file
            String content = new String(Files.readAllBytes(Paths.get(jsonFilePath)));
            JSONObject json = new JSONObject(content);

            // Map to hold all extracted diagnostics
            Map<String, Map<String, String>> auditDiagnostics = new HashMap<>();

            // Check and extract diagnostics for each audit
            extractAuditData(json, "audits", auditDiagnostics);

            diagnostics.put("auditDiagnostics", auditDiagnostics);

        } catch (Exception e) {
            System.err.println("Error reading diagnostics from JSON file: " + e.getMessage());
        }
        return diagnostics;
    }
    
    private static void extractAuditData(JSONObject json, String auditKey, Map<String, Map<String, String>> auditDiagnostics) {
        // Check if the given auditKey exists in the JSON
        if (json.has(auditKey)) {
            JSONObject audits = json.getJSONObject(auditKey);

            // Iterate through each audit and extract only the 'title' and 'description'
            for (String auditKeyName : audits.keySet()) {
                JSONObject audit = audits.getJSONObject(auditKeyName);

                Map<String, String> diagnosticData = new HashMap<>();

                // Extract 'title' and 'description' from the audit
                if (audit.has("title")) {
                    diagnosticData.put("title", audit.optString("title", "No title"));
                }
                if (audit.has("description")) {
                    diagnosticData.put("description", audit.optString("description", "No description"));
                }

                // Add the extracted data (title and description) to the map
                auditDiagnostics.put(auditKeyName, diagnosticData);
            }
        }
    }
    			    
    }

