package PlaywrightUIPageload;

import com.microsoft.playwright.Browser;
import com.microsoft.playwright.ElementHandle;
import com.microsoft.playwright.Frame;
import com.microsoft.playwright.Locator;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.PlaywrightException;
import com.microsoft.playwright.options.LoadState;
import com.microsoft.playwright.options.WaitForSelectorState;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.text.SimpleDateFormat;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.Future;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.CountDownLatch;
import org.json.JSONObject;


public class ScriptedTestExecutor {

    private static final DateTimeFormatter timestampFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    public static void executeTests(Properties properties) {
        try {
            String configFilePath = resolveConfigPath(properties);
            if (configFilePath == null) {
                throw new IllegalArgumentException("configFilePath property is missing.");
            }

            Map<String, String> config = ConfigurationManager.readConfigFromCSV(configFilePath);
            String scriptedPath = properties.getProperty("ScriptedTestCasesFilePath");
            if (scriptedPath == null || scriptedPath.isEmpty()) {
                System.err.println("ScriptedTestCasesFilePath property is missing.");
                return;
            }

            List<Map<String, String>> testCasesList = ScriptedTestCaseManager.readScriptedTestCasesFromCSV(scriptedPath);
            if (testCasesList == null || testCasesList.isEmpty()) {
                System.err.println("No scripted test cases found in: " + scriptedPath);
                return;
            }

            String runId = RunIdManager.getRunId();
            String resultDirectory = properties.getProperty("ResultDirectory") + File.separator + "Scripted_RunID_" + runId;
            new File(resultDirectory).mkdirs();

            final int numThreads = ConfigHelper.getMultiThreading(config);
            final double durationSeconds = ConfigHelper.getTestDurationSeconds(config);
            final boolean durationMode = durationSeconds >= 0;
            final Map<String, List<Map<String, String>>> groupedTestCases = groupTestCasesByName(testCasesList);
            final List<String> flowNames = new ArrayList<>(groupedTestCases.keySet());
            final ExecutionGovernor governor = ExecutionGovernor.create(resultDirectory, durationSeconds);
            final ParallelWorkQueue<String> flowQueue = new ParallelWorkQueue<>(flowNames, durationMode);

            System.out.println("Scripted multi-threaded execution — " + numThreads + " parallel browsers, "
                    + flowNames.size() + " flow(s), duration: "
                    + (durationMode ? durationSeconds + "s" : "unlimited"));

            Reporter.initialize(resultDirectory);

            ThreadPoolExecutor executor = new ThreadPoolExecutor(
                    numThreads, numThreads,
                    0L, TimeUnit.MILLISECONDS,
                    new LinkedBlockingQueue<>(),
                    r -> {
                        Thread t = new Thread(r);
                        t.setName("scripted-worker");
                        return t;
                    });
            executor.prestartAllCoreThreads();

            CountDownLatch browsersReady = new CountDownLatch(numThreads);
            List<Future<?>> futures = new ArrayList<>();

            for (int t = 0; t < numThreads; t++) {
                final int workerId = t + 1;
                futures.add(executor.submit(() -> {
                    Thread.currentThread().setName("scripted-worker-" + workerId);
                    try (com.microsoft.playwright.Playwright playwright = com.microsoft.playwright.Playwright.create()) {
                        Browser browser = BrowserManager.launchBrowser(config, playwright, workerId);
                        browsersReady.countDown();
                        try {
                            while (governor.shouldAcceptNewWork()) {
                                String testCaseName = flowQueue.claimNext();
                                if (testCaseName == null) {
                                    break;
                                }
                                System.out.println("[Worker " + workerId + "] Running scripted flow: " + testCaseName);
                                governor.workStarted();
                                try {
                                    executeTestCase(browser, testCaseName, groupedTestCases.get(testCaseName), config);
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
                        System.err.println("[Worker " + workerId + "] Scripted execution error: " + e.getMessage());
                        e.printStackTrace();
                    }
                }));
            }

            try {
                browsersReady.await(120, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            governor.startDurationClock();

            for (Future<?> future : futures) {
                future.get();
            }
            governor.awaitInflightCompletion(300_000);

            executor.shutdown();
            if (!executor.awaitTermination(120, TimeUnit.SECONDS)) {
                executor.shutdownNow();
            }

            Reporter.finalizeReport();
            System.out.println("Scripted test execution completed.");
        } catch (Exception e) {
            System.err.println("Scripted test execution failed: " + e.getMessage());
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

    public static void executeTests(Browser browser, List<Map<String, String>> testCasesList, String resultDirectory) {
        Reporter.initialize(resultDirectory);
        Map<String, List<Map<String, String>>> groupedTestCases = groupTestCasesByName(testCasesList);
        for (String testCaseName : groupedTestCases.keySet()) {
            executeTestCase(browser, testCaseName, groupedTestCases.get(testCaseName), null);
        }
        Reporter.finalizeReport();
    }

    private static Map<String, List<Map<String, String>>> groupTestCasesByName(List<Map<String, String>> testCasesList) {
        // Group test cases by their name
        Map<String, List<Map<String, String>>> groupedTestCases = new HashMap<>();
        for (Map<String, String> testCase : testCasesList) {
            String testCaseName = testCase.get("Test_Case_Name");
            groupedTestCases.computeIfAbsent(testCaseName, k -> new ArrayList<>()).add(testCase);
        }
        return groupedTestCases;
    }

    private static void executeTestCase(Browser browser, String testCaseName, List<Map<String, String>> testCaseSteps, Map<String, String> config) {
    	
    	
    	System.out.println("Executing test case: " + testCaseName);

        try {
            Browser.NewPageOptions options = new Browser.NewPageOptions().setViewportSize(1920, 1080).setScreenSize(1920, 1080);
            Page page = browser.newPage(options);
            Frame frame = null;

            for (Map<String, String> step : testCaseSteps) {
                frame = executeTestStep(page, frame, step);
                if (config != null) {
                    ConfigHelper.sleepThinkTime(config);
                }
            }

            page.close();

            System.out.println("Test case '" + testCaseName + "' completed.");

        } catch (Exception e) {
            e.printStackTrace();
            System.err.println("Failed to execute test case '" + testCaseName + "': " + e.getMessage());
        }
    }

    private static Frame executeTestStep(Page page, Frame frame, Map<String, String> step) throws UnknownHostException, Exception {
        String action = step.get("Action");
        String transactionName = step.get("Transaction_Name");
        String request = step.get("Request");
        String selector = step.get("Selector");
        String textToSet = step.get("Parameter");
        String testStepName = step.get("Test_Steps");
        String elementIdentifier = step.get("Element identifier");
        String frameSelector = step.get("Frame_Selector");
        String timeoutStr = step.get("Timeout");
        String failureReason = "NA";
        
        int timeout = timeoutStr != null && !timeoutStr.isEmpty() ? Integer.parseInt(timeoutStr) : 120000; // Default to 120 seconds if not provided
        
        long navigationStart = 0;
        long loadEventEnd = 0;
        long connectEnd = 0;
        long domainLookupStart = 0;
        long domainLookupEnd = 0;
        long connectStart = 0;
        long responseEnd = 0;
        long responseStart = 0;
        long requestStart = 0;
        long domLoading = 0;
        long domInteractive = 0;
        long domComplete = 0;
        long pageLoadTimeCalculated = 0;
        long networkTime = 0;
        long dnsLookupTime = 0;
        long connectionTime = 0;
        long serverProcessingTime = 0;
        long responseTime = 0;
        long browserTime = 0;
        long domInteractionTime = 0;
        long domCompleteTime = 0;
        long fcp = 0;
        long lcp = 0;
        long tbt = 0;
        double cls = 0.0;
        long speedIndex = 0;
        double performanceScore = 0.0; 
        
        System.out.println("Executing action: " + action);
        
        if (!action.equals("ThinkTime")) {
        long startTime = System.currentTimeMillis();
        int fullPageLoadTime = 0;
        long loadTime = -1; // Initialize loadTime with -1 to handle "NA" case

        // Validate required fields
        if ((selector == null || selector.isEmpty()) && !action.equals("SwitchWindow") && !action.equals("Navigate")) {
            System.err.println("Selector is required for action: " + action);
            return frame;
        }

        try {
            if (frameSelector != null && !frameSelector.isEmpty()) {
                System.out.println("Switching to frame: " + frameSelector);
                frame = switchToFrame(page, frameSelector);
                if (frame == null) {
                    System.err.println("Frame not found: " + frameSelector);
                    return frame;
                }
            }

            switch (action) {
                case "Click":
                    if (frame != null) {
                        Action.click(frame, selector);
                    } else {
                        Action.click(page, selector);
                    }
                    break;
                case "Set_Text":
                    if (frame != null) {
                        Action.setText(frame, selector, textToSet);
                    } else {
                        Action.setText(page, selector, textToSet);
                    }
                    break;
                case "WaitForSelector":
                    if (frame != null) {
                        Action.waitForSelector(frame, selector);
                    } else {
                        Action.waitForSelector(page, selector);
                    }
                    break;
                case "SelectOption":
                    if (frame != null) {
                        Action.selectOption(frame, selector, textToSet);
                    } else {
                        Action.selectOption(page, selector, textToSet);
                    }
                    break;
                case "Check":
                    if (frame != null) {
                        Action.check(frame, selector);
                    } else {
                        Action.check(page, selector);
                    }
                    break;
                case "Uncheck":
                    if (frame != null) {
                        Action.uncheck(frame, selector);
                    } else {
                        Action.uncheck(page, selector);
                    }
                    break;
                case "Hover":
                    if (frame != null) {
                        Action.hover(frame, selector);
                    } else {
                        Action.hover(page, selector);
                    }
                    break;
                case "PressKey":
                    if (frame != null) {
                        Action.pressKey(frame, selector, textToSet);
                    } else {
                        Action.pressKey(page, selector, textToSet);
                    }
                    break;
                case "ThinkTime":
                    Action.waitForTimeout(page, Integer.parseInt(textToSet));
                    break;
                case "CalculateFullPageLoadTime":
                    waitForPageLoad(page);
                    break;
                case "SwitchFrame":
                    frame = switchToFrame(page, selector);
                    break;
                case "Navigate":
                    Action.navigate(page, textToSet);
                    break;
                case "SwitchWindow":
                    switchToNewWindow(page);
                    break;
                case "Get_Text":
                    String text = getTextFromPage(page, elementIdentifier);
                    System.out.println("Text from new window/tab: " + text);
                    break;
                case "ClickSwitchToNewTabAndGetText":
                    String clickSelector = step.get("Click_Selector");
                    ClickSwitchToNewTabAndGetText(page, clickSelector, elementIdentifier);
                    break;
                case "SwitchToNewTabAndGetText":
                    switchToNewTabAndGetText(page, elementIdentifier);
                    break;
                case "WaitUntilElementIsVisible":
                    if (frame != null) {
                        Action.waitUntilElementIsVisible(frame, selector, timeout);
                    } else {
                        Action.waitUntilElementIsVisible(page, selector, timeout);
                    }
                    break;
                default:
                    System.out.println("Unsupported action: " + action);
                    failureReason = "Unsupported action: " + action;
                    throw new Exception(failureReason);
            }
                if (frame != null) {
                    Action.waitUntilElementIsVisible(frame, elementIdentifier, timeout);
                } else {
                    Action.waitUntilElementIsVisible(page, elementIdentifier, timeout);
                }
            // Calculate page load time using JavaScript           
            if (action.equals("Navigate") || action.equals("CalculateFullPageLoadTime")) {
            	page.waitForLoadState(LoadState.LOAD);
            	 Object pageLoadTimeObject = page.evaluate("window.performance.timing.loadEventEnd - window.performance.timing.navigationStart");
            	 String timingJson = (String) page.evaluate("() => { const timing = window.performance.timing; return JSON.stringify({ navigationStart: timing.navigationStart, loadEventEnd: timing.loadEventEnd, connectEnd: timing.connectEnd, domainLookupStart: timing.domainLookupStart, domainLookupEnd: timing.domainLookupEnd, connectStart: timing.connectStart, responseEnd: timing.responseEnd, responseStart: timing.responseStart, requestStart: timing.requestStart, domLoading: timing.domLoading, domInteractive: timing.domInteractive, domComplete: timing.domComplete }); }");
                 JSONObject timing = new JSONObject(timingJson);
          
				
                 navigationStart = timing.getLong("navigationStart");
                 loadEventEnd = timing.getLong("loadEventEnd");
                 connectEnd = timing.getLong("connectEnd");
                 domainLookupStart = timing.getLong("domainLookupStart");
                 domainLookupEnd = timing.getLong("domainLookupEnd");
                 connectStart = timing.getLong("connectStart");
                 responseEnd = timing.getLong("responseEnd");
                 responseStart = timing.getLong("responseStart");
                 requestStart = timing.getLong("requestStart");
                 domLoading = timing.getLong("domLoading");
                 domInteractive = timing.getLong("domInteractive");
                 domComplete = timing.getLong("domComplete");
                 pageLoadTimeCalculated = loadEventEnd - navigationStart;
                 networkTime = connectEnd - domainLookupStart;
                 dnsLookupTime = domainLookupEnd - domainLookupStart;
                 connectionTime = connectEnd - connectStart;
                 serverProcessingTime = responseEnd - responseStart;
                 responseTime = responseEnd - requestStart;
                 browserTime = loadEventEnd - domLoading;
                 domInteractionTime = domInteractive - domLoading;
                 domCompleteTime = domComplete - domLoading;
                
                System.out.println("Calculated Page Load Time (from timing): " + pageLoadTimeCalculated + "ms");
                
                // Now, run UEM and get the performance score and related metrics
                
//                System.out.println("......................Running UEM Execution........................");
//                try {
//                    String UEMPath = "C:\\Users\\SanatanJha\\AppData\\Roaming\\npm\\node_modules\\lighthouse\\cli\\index.js"; // Update as necessary
//                    String resultDirectory = "C:\\Users\\SanatanJha\\Downloads\\Genesis\\UIFramework\\Results\\";
//                    String timestamp = new SimpleDateFormat("yyyyMMddHHmmss").format(new Date());
//                    String outputPath = resultDirectory + "lighthouse_result_" + timestamp + ".json";
//
//                    String[] command = {
//                        "node",
//                        UEMPath,
//                        textToSet,
//                        "--output=json",
//                        "--output-path=" + outputPath,
//                        "--chrome-flags=--headless --no-sandbox --disable-gpu --disable-extensions --ignore-certificate-errors --disable-software-rasterizer",
//                        "--only-categories=performance",
//                        "--emulated-form-factor=desktop",
//                        "--disable-js-sampling",
//                        "--skip-audits=total-idle-time"
//                    };
//
//                    ProcessBuilder processBuilder = new ProcessBuilder(command);
//                    processBuilder.redirectErrorStream(false);  // Don't merge stderr with stdout
//                    Process process = processBuilder.start();
//
//                    // Read stdout
//                    BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()));
//                    StringBuilder UEMOutput = new StringBuilder();
//                    String line;
//                    while ((line = reader.readLine()) != null) {
//                        UEMOutput.append(line).append("\n");
//                    }
//
//                    // Read stderr
//                    BufferedReader errorReader = new BufferedReader(new InputStreamReader(process.getErrorStream()));
//                    StringBuilder errorOutput = new StringBuilder();
//                    while ((line = errorReader.readLine()) != null) {
//                        errorOutput.append(line).append("\n");
//                    }
//
//                    int exitCode = process.waitFor();
//                    if (exitCode != 0) {
//                        System.err.println("Failed to generate UEM report for URL: " + textToSet);
//                        System.err.println("Lighthouse output: " + UEMOutput.toString());
//                        System.err.println("Lighthouse error output: " + errorOutput.toString());
//                        return frame;
//                    }
//
//                    String output = UEMOutput.toString().trim();
//                    String errors = errorOutput.toString().trim();
//
//                    // Debugging the raw output
//                    System.out.println("Lighthouse raw output:\n" + output);
//                    System.out.println("Lighthouse error output:\n" + errors);
//
//                    // Check if the output is empty or contains invalid characters
//                    if (output.isEmpty() || !output.startsWith("{") || !output.endsWith("}")) {
//                        System.err.println("Lighthouse did not return valid JSON. Output: " + output);
//                        return frame;
//                    }
//
//                    // Validate the JSON structure
//                    try {
//                        JSONObject jsonObject = new JSONObject(output);
//
//                        // Extract values
//                        fcp = (long) jsonObject.getJSONObject("audits").getJSONObject("first-contentful-paint").getDouble("numericValue");
//                        lcp = (long) jsonObject.getJSONObject("audits").getJSONObject("largest-contentful-paint").getDouble("numericValue");
//                        tbt = (long) jsonObject.getJSONObject("audits").getJSONObject("total-blocking-time").getDouble("numericValue");
//                        cls = jsonObject.getJSONObject("audits").getJSONObject("cumulative-layout-shift").getDouble("numericValue");
//                        speedIndex = (long) jsonObject.getJSONObject("audits").getJSONObject("speed-index").getDouble("numericValue");
//                        performanceScore = jsonObject.getJSONObject("categories").getJSONObject("performance").getDouble("score");
//
//                        // Output results
//                        System.out.println("Performance Metrics:");
//                        System.out.println("FCP: " + fcp);
//                        System.out.println("LCP: " + lcp);
//                        System.out.println("TBT: " + tbt);
//                        System.out.println("CLS: " + cls);
//                        System.out.println("Speed Index: " + speedIndex);
//                        System.out.println("Performance Score: " + performanceScore);
//                        
//                    } catch (Exception e) {
//                        System.err.println("Error during JSON parsing: " + e.getMessage());
//                        e.printStackTrace();
//                    }
//
//                } catch (Exception e) {
//                    System.err.println("Error during Lighthouse execution: " + e.getMessage());
//                    e.printStackTrace();
//                }


                // Ensure the returned value is valid and of a supported type
                if (pageLoadTimeObject instanceof Number) {
                    double pageLoadTimeDouble = ((Number) pageLoadTimeObject).doubleValue();

                    // Check if the page load time is negative, and handle it
                    if (pageLoadTimeDouble < 0) {
                        System.err.println("Page load time is negative: " + pageLoadTimeDouble);
                        fullPageLoadTime = 0; // Set a default value or handle as needed
                    } else {
                        // Safely convert to an integer without overflow
                        fullPageLoadTime = (int) Math.min(pageLoadTimeDouble, Integer.MAX_VALUE);
                    }
                } else {
                    System.err.println("Unexpected data type for page load time: " + pageLoadTimeObject.getClass().getName());
                    fullPageLoadTime = 0; // Handle unexpected data type
                }
     
                System.out.println("Full page load time: " + fullPageLoadTime + "ms");
            }
            
            
            long endTime = System.currentTimeMillis();
            loadTime = endTime - startTime;
        
            System.out.println("Action '" + action + "' completed.");

        } catch (Exception e) {
            e.printStackTrace();
            loadTime = -1;
            try {
                failureReason = parseFailureReason(e);
            } catch (Exception e1) {
                e1.printStackTrace();
            }
            System.err.println("Failed to execute action '" + action + "': " + failureReason);
        }

        boolean elementVisible = false;
        try {
            if (frame != null) {
                elementVisible = frame.isVisible(elementIdentifier);
            } else {
                elementVisible = page.isVisible(elementIdentifier);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }

        // Determine test status and update failure reason if load time is "NA"
        String testStatus = (loadTime == -1 ? "FAIL" : (elementVisible ? "PASS" : "FAIL"));
        if (testStatus.equals("FAIL") && (loadTime == -1)) {
            failureReason = "Load time is NA.";
        }

        String hostname = InetAddress.getLocalHost().getHostName();
        String runId = RunIdManager.getRunId();
        Reporter.logResult(
            runId,
            LocalDateTime.now().format(timestampFormatter),
            transactionName,
            hostname,
            testStepName,
            request,
            elementIdentifier,
            loadTime == -1 ? "" : String.valueOf(loadTime),
            fullPageLoadTime == 0 ? "" : String.valueOf(fullPageLoadTime),
            testStatus,
            testStatus.equals("FAIL") ? failureReason : "",
            	
           // Navigation Timing Data	
		   String.valueOf(pageLoadTimeCalculated),
		   String.valueOf(networkTime),
		   String.valueOf(dnsLookupTime),
		   String.valueOf(connectionTime),
		   String.valueOf(serverProcessingTime),
		   String.valueOf(responseTime),
		   String.valueOf(browserTime),
		   String.valueOf(domInteractionTime),
	       String.valueOf(domCompleteTime),
               
	      // UEM Data
          String.valueOf(fcp),
          String.valueOf(lcp),
          String.valueOf(tbt),
          String.valueOf(cls),
          String.valueOf(speedIndex),
          String.valueOf(performanceScore) 	
           
        );

        return frame;
    }
		return frame;
		
    }

    public static Properties loadProperties(String filePath) throws IOException {
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


	private static Frame switchToFrame(Page page, String frameSelector) {
        try {
            // Locate the frame element first
            Locator frameLocator = page.locator(frameSelector);

            // Wait for the frame to be attached to the DOM
            frameLocator.waitFor(new Locator.WaitForOptions()
                .setState(WaitForSelectorState.ATTACHED)
                .setTimeout(5000)); // Adjust timeout as needed

            // Get the underlying element handle from the locator
            ElementHandle frameElement = frameLocator.elementHandle();

            if (frameElement != null) {
                // Scroll the frame into view to ensure visibility
                page.evaluate("element => element.scrollIntoView()", frameElement);

                // Wait explicitly for the frame to become visible
                frameLocator.waitFor(new Locator.WaitForOptions()
                    .setState(WaitForSelectorState.VISIBLE)
                    .setTimeout(5000)); // Adjust timeout as needed

                // Check if the frame is visible
                if (frameLocator.isVisible()) {
                    // Return the frame associated with the frame element
                    Frame frame = frameElement.contentFrame();

                    if (frame != null) {
                        System.out.println("Switched to frame: " + frameSelector);
                        return frame;
                    } else {
                        System.err.println("No content frame associated with element: " + frameSelector);
                    }
                } else {
                    System.err.println("Frame is not visible after waiting: " + frameSelector);
                }
            } else {
                System.err.println("Element handle is null for frame: " + frameSelector);
            }
        } catch (PlaywrightException e) {
            System.err.println("Failed to switch to frame: " + frameSelector + ". Error: " + e.getMessage());
        } catch (Exception e) {
            System.err.println("Unexpected error while switching to frame: " + frameSelector + ". Error: " + e.getMessage());
        }
        return null;
    }

    private static void switchToNewWindow(Page page) {
        try {
            // Get all pages in the browser context
            List<Page> pages = new ArrayList<>(page.context().pages());
            // Assuming the new window is the last one opened
            if (pages.size() > 1) {
                Page newWindow = pages.get(pages.size() - 1);
                // Bring the new window to the front
                newWindow.bringToFront();
            } else {
                System.err.println("No new window found to switch to.");
            }
        } catch (Exception e) {
            System.err.println("Failed to switch to new window. Error: " + e.getMessage());
        }
    }

    private static String getTextFromPage(Page page, String selector) {
        try {
            // Wait for the selector to be visible
            page.waitForSelector(selector);
            // Get the text content of the element
            return page.textContent(selector);
        } catch (Exception e) {
            System.err.println("Failed to get text from page. Selector: " + selector + ". Error: " + e.getMessage());
            return "";
        }
    }

    private static void waitForPageLoad(Page page) {
        try {
            // Wait for the page to load completely
        	
        } catch (Exception e) {
            System.err.println("Failed to wait for page load. Error: " + e.getMessage());
        }
    }

    private static void ClickSwitchToNewTabAndGetText(Page page, String clickSelector, String elementIdentifier) {
        try {
            // Click the link that opens a new tab
            page.click(clickSelector);
            page.waitForTimeout(5000); // Adjust the timeout as necessary
            
            // Switch to the new tab
            List<Page> pages = new ArrayList<>(page.context().pages());
            if (pages.size() > 1) {
                Page newTab = pages.get(pages.size() - 1);
                newTab.bringToFront();
                // Get text from the new tab
                String text = getTextFromPage(newTab, elementIdentifier);
                System.out.println("Text from new tab: " + text);
            } else {
                System.err.println("No new tab found.");
            }
        } catch (Exception e) {
            System.err.println("Failed to click and switch to new tab. Error: " + e.getMessage());
        }
    }

    private static void switchToNewTabAndGetText(Page page, String textSelector) {
        try {
            // Switch to the new tab
            List<Page> pages = new ArrayList<>(page.context().pages());
            if (pages.size() > 1) {
                Page newTab = pages.get(pages.size() - 1);
                newTab.bringToFront();
                // Get text from the new tab
                String text = getTextFromPage(newTab, textSelector);
                System.out.println("Text from new tab: " + text);
            } else {
                System.err.println("No new tab found.");
            }
        } catch (Exception e) {
            System.err.println("Failed to switch to new tab. Error: " + e.getMessage());
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
        }
    }
    
   
}
