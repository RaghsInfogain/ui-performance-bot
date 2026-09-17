# UI Performance Bot — Functionalities by Module

Complete list of functionalities in the application, grouped by module.

---

## 1. Application Entry & Orchestration (Main)

| # | Functionality | Description |
|---|---------------|--------------|
| 1.1 | Load properties | Load execution settings from `Properties.properties` (paths, file references). |
| 1.2 | Load configuration | Read `config.csv` via ConfigurationManager (headless, browser, duration, flags, crawl URL, etc.). |
| 1.3 | Validate config | Ensure `configFilePath` and `ResultDirectory` are present and valid. |
| 1.4 | Test duration handling | Parse `Test_Duration_Seconds`; support fixed duration (seconds) or no limit (NA/0). |
| 1.5 | Mode selection | Decide execution path from flags: **ScriptedFlow** vs **User Experience (static)**. |
| 1.6 | Auto-crawl trigger | If AutoCrawl + (ScriptedFlow or UserExperience): validate CrawlerURL, run crawler, then use crawled CSV as test source. |
| 1.7 | Static test source | If not AutoCrawl: use `UserExperienceTestCaseFilePath` (static URL list) from properties. |
| 1.8 | Scripted test source | When ScriptedFlow: use `ScriptedTestCasesFilePath` from properties for scripted test cases. |
| 1.9 | Playwright lifecycle | Create Playwright instance; launch browser via BrowserManager; run test loop. |
| 1.10 | Result filename generation | Generate timestamped result path, e.g. `Test_Results_yyyyMMdd_HHmmss.csv`. |
| 1.11 | Execution loop | Run tests until test duration is exceeded (if set) or test set is exhausted. |
| 1.12 | URL validation | Validate CrawlerURL format before starting crawl. |

---

## 2. Configuration Module (ConfigurationManager)

| # | Functionality | Description |
|---|---------------|--------------|
| 2.1 | Read config from CSV | Parse key-value pairs from config CSV (one key,value per line). |
| 2.2 | Config keys supported | Headless_Mode, BrowserType, Test_Duration_Seconds, TakeScreenshot, ScriptedFlow, UserExperience, AutoCrawl, Think_Time, Multi_Threading, CrawlerURL. |

---

## 3. Run ID Module (RunIdManager)

| # | Functionality | Description |
|---|---------------|--------------|
| 3.1 | Get current run ID | Return same run ID for the entire test run (singleton per process). |
| 3.2 | Load and increment run ID | Read from `runId.txt`; increment; save next ID for future runs. |
| 3.3 | Persist run ID | Write incremented run ID back to `runId.txt`. |
| 3.4 | Default run ID | Use "0001" if file missing or unreadable. |

---

## 4. Crawling Module (URLCrawler)

| # | Functionality | Description |
|---|---------------|--------------|
| 4.1 | Same-domain crawl | Crawl only links under the same domain as the start URL. |
| 4.2 | Visit tracking | Maintain set of visited URLs to avoid duplicates and loops. |
| 4.3 | Skip invalid URLs | Skip URLs that are already visited or outside domain. |
| 4.4 | HTTP request | Use Jsoup to connect with custom User-Agent and referrer. |
| 4.5 | Status code handling | Skip 404; handle 403 (access denied). |
| 4.6 | Link extraction | Parse HTML and extract all `a[href]` links; resolve to absolute URLs. |
| 4.7 | Transaction name generation | Derive transaction name from URL path (or "Landing_Pages" for root). |
| 4.8 | CSV output | Write crawled URLs to `crawled_urls_<runId>.csv` with columns: Transaction Name, Path Page URL, Element Identifier, Element Selector. |
| 4.9 | Append mode | Create file with header on first write; append rows on subsequent pages. |
| 4.10 | Update properties | After crawl, update `testCaseFiles` in Properties with the new crawled CSV path. |
| 4.11 | SSL relaxation | Optional disable of SSL certificate validation for testing. |

---

## 5. Browser Module (BrowserManager)

| # | Functionality | Description |
|---|---------------|--------------|
| 5.1 | Launch browser | Launch Playwright browser based on config. |
| 5.2 | Browser type support | Chromium (chrome), Firefox, WebKit. |
| 5.3 | Headless mode | Set headless on/off from `Headless_Mode` config. |

---

## 6. Static / User Experience Test Execution (TestExecutor)

| # | Functionality | Description |
|---|---------------|--------------|
| 6.1 | Resolve test case source | If AutoCrawl: pick latest `crawled_urls_*.csv`; else use UserExperienceTestCaseFilePath (single or comma-separated files). |
| 6.2 | Read test cases | Load static test cases from CSV(s) via TestDataManager (Transaction Name, Path Page URL, Element Selector, etc.). |
| 6.3 | Multi-threading | Run static URL tests in a thread pool; size from `Multi_Threading` config. |
| 6.4 | Per-URL visit | For each URL: navigate, wait for load, optionally wait for element, measure timings. |
| 6.5 | Duration-based execution | If Test_Duration_Seconds set: allow URL revisit and stop when duration exceeded; else visit each URL once. |
| 6.6 | Navigation + load wait | Navigate to URL; wait for LoadState.LOAD. |
| 6.7 | Full page load time | Read `window.performance.timing` (loadEventEnd - navigationStart). |
| 6.8 | Element load time | If Element Selector provided: wait up to 5s for element visible; record time to visibility. |
| 6.9 | Result directory per run | Create `Static_RunID_<runId>` under ResultDirectory. |
| 6.10 | UEM (Lighthouse) run | If UserExperience: run Lighthouse CLI for URL; generate JSON report; parse and append to CSV. |
| 6.11 | UEM metrics | Extract FCP, LCP, TBT, CLS, Speed Index, Performance Score from Lighthouse JSON. |
| 6.12 | Navigation timing in UEM flow | After Lighthouse, open page in Playwright and evaluate performance.timing for network/DOM metrics. |
| 6.13 | UEM CSV report | Append row to Static_Run_Report CSV: Run_ID, Timestamp, HostName, Transaction, Page URL, FCP, LCP, TBT, CLS, Speed Index, Performance Score, Page Load Time, Network/DNS/Connection/Server/Response/Browser/DOM times, Element Load Time, Test Status, Failure Reason, Audit Titles, Audit Scores, TBT Savings. |
| 6.14 | Non-UEM path | If UserExperience false: call navigateAndMeasure (page load + element load only); write result via ResultReporter. |
| 6.15 | Think time | Apply configurable delay (Think_Time ms) between URLs. |
| 6.16 | Screenshot on demand | If TakeScreenshot: capture page screenshot to ScreenshotDirectory. |
| 6.17 | Stop flag | Use atomic stop flag when duration exceeded; stop submitting new tasks and signal running tasks to exit. |
| 6.18 | Graceful shutdown | Await executor termination with timeout; shutdownNow if needed. |
| 6.19 | Element load time for UEM | Measure element visibility time in separate Playwright run when UserExperience is on; pass to UEM CSV row. |

---

## 7. Scripted Test Execution (ScriptedTestExecutor)

| # | Functionality | Description |
|---|---------------|--------------|
| 7.1 | Initialize reporter | Create/append scripted result CSV under result directory; write header once. |
| 7.2 | Group steps by test case | Group scripted rows by Test_Case_Name; execute each group as one test case. |
| 7.3 | New page per test case | Open new browser page (viewport 1920x1080) per test case. |
| 7.4 | Execute steps in order | Run each step in sequence; support frame context. |
| 7.5 | Frame handling | Switch to frame via Frame_Selector when provided; run actions in frame or page context. |
| 7.6 | Action: Navigate | Navigate to URL (Parameter = URL). |
| 7.7 | Action: Click | Click element by Selector (page or frame). |
| 7.8 | Action: Set_Text | Fill input with Parameter (page or frame). |
| 7.9 | Action: WaitForSelector | Wait for selector (page or frame). |
| 7.10 | Action: SelectOption | Select option by value (Parameter) (page or frame). |
| 7.11 | Action: Check | Check checkbox/radio (page or frame). |
| 7.12 | Action: Uncheck | Uncheck (page or frame). |
| 7.13 | Action: Hover | Hover over element (page or frame). |
| 7.14 | Action: PressKey | Press key on element (Parameter = key) (page or frame). |
| 7.15 | Action: ThinkTime | Wait for Parameter ms. |
| 7.16 | Action: CalculateFullPageLoadTime | Wait for load; then read performance.timing and optional Lighthouse. |
| 7.17 | Action: SwitchFrame | Switch to frame by selector. |
| 7.18 | Action: SwitchWindow | Switch to the last opened window/tab. |
| 7.19 | Action: Get_Text | Get text from element (Element identifier). |
| 7.20 | Action: ClickSwitchToNewTabAndGetText | Click Click_Selector; switch to new tab; get text from Element identifier. |
| 7.21 | Action: SwitchToNewTabAndGetText | Switch to new tab; get text from element. |
| 7.22 | Action: WaitUntilElementIsVisible | Wait for selector visible with configurable Timeout (default 120s). |
| 7.23 | Navigation timing extraction | On Navigate/CalculateFullPageLoadTime: read performance.timing (navigationStart, loadEventEnd, DNS, connection, response, DOM times). |
| 7.24 | Step load time | Record elapsed time for step (start to end). |
| 7.25 | Full page load time from timing | Compute loadEventEnd - navigationStart; handle negative/invalid. |
| 7.26 | Test status | PASS if load time valid and element visible; FAIL otherwise. |
| 7.27 | Failure reason | Parse exception (Timeout → "Element not Found", DOMException → "DOMException", else generic message). |
| 7.28 | Log result row | Append CSV row: Run_ID, Timestamp, Transaction, HostName, Test Step Name, Request, Waiting Element, Waiting Element Load Time, Playwright Page Load Time, Test Status, Failure Reason, Page Load Time, Network/DNS/Connection/Server/Response/Browser/DOM times, FCP, LCP, TBT, CLS, Speed Index, Performance Score. |
| 7.29 | Finalize report | Flush and close scripted result CSV. |

---

## 8. UI Actions (Action)

| # | Functionality | Description |
|---|---------------|--------------|
| 8.1 | Navigate | page.navigate(url). |
| 8.2 | Click | page/frame.click(selector). |
| 8.3 | SetText (fill) | page/frame.fill(selector, text). |
| 8.4 | WaitForSelector | page/frame.waitForSelector(selector); ensure visible. |
| 8.5 | SelectOption | page/frame.selectOption(selector, value). |
| 8.6 | Check | page/frame.check(selector). |
| 8.7 | Uncheck | page/frame.uncheck(selector). |
| 8.8 | Hover | page/frame.hover(selector). |
| 8.9 | PressKey | page/frame.press(selector, key). |
| 8.10 | WaitForTimeout | page.waitForTimeout(ms). |
| 8.11 | WaitUntilElementIsVisible | page/frame.waitForSelector(selector, VISIBLE, timeout). |

---

## 9. Test Data Management

### 9.1 Static / Crawled test cases (TestDataManager)

| # | Functionality | Description |
|---|---------------|--------------|
| 9.1.1 | Read test cases from CSV | Parse CSV with header row; return list of maps (header → value). |
| 9.1.2 | Handle empty lines | Skip blank lines. |
| 9.1.3 | Handle missing columns | Pad with empty string if row has fewer columns than headers. |
| 9.1.4 | Trim values | Trim header and cell values. |

### 9.2 Scripted test cases (ScriptedTestCaseManager)

| # | Functionality | Description |
|---|---------------|--------------|
| 9.2.1 | Read scripted test cases from CSV | Parse CSV; first row = headers; each subsequent row = one step (map of header → value). |
| 9.2.2 | Skip empty lines | Ignore blank lines. |
| 9.2.3 | Handle short rows | Use empty string for missing cells. |

---

## 10. Reporting Module

### 10.1 Static / simple result (ResultReporter)

| # | Functionality | Description |
|---|---------------|--------------|
| 10.1.1 | Write test result to CSV | Append one row: Run ID, Timestamp, Transaction Name, Page URL, Full Page Load Time, Element Load Time, Test Status. |
| 10.1.2 | Header on new file | Write header only when file is created. |

### 10.2 Scripted result (Reporter)

| # | Functionality | Description |
|---|---------------|--------------|
| 10.2.1 | Initialize | Create/open scripted result CSV; write header if new file. |
| 10.2.2 | Log result | Append one row with Run_ID, Timestamp, Transaction, HostName, Test Step Name, Request, Waiting Element, load times, status, failure reason, Navigation Timing fields, Lighthouse fields. |
| 10.2.3 | Log text | Append line to optional text log file (e.g. Get_Text output). |
| 10.2.4 | Finalize | Flush and close writer. |

---

## 11. Lighthouse / UEM Module (TestExecutor + LighthouseRunner)

| # | Functionality | Description |
|---|---------------|--------------|
| 11.1 | Run Lighthouse CLI | Invoke Node Lighthouse CLI (configurable path) with URL, --output=json, --output-path, Chrome flags (headless, no-sandbox, etc.), --only-categories=performance. |
| 11.2 | Parse Lighthouse JSON | Read FCP, LCP, TBT, CLS, Speed Index from audits; Performance Score from categories.performance. |
| 11.3 | Extract audit diagnostics | Optional: extract audit title, description, score, TBT savings for CSV columns. |
| 11.4 | Standalone Lighthouse run | LighthouseRunner.runLighthouseForUrls: for each URL run Lighthouse, parse, write to single CSV (URL, FCP, LCP, TBT, CLS, Speed Index, Performance Score). |
| 11.5 | Temporary file cleanup | Delete temporary Lighthouse JSON after parse (in LighthouseRunner). |

---

## 12. Database Module (DatabaseManager + TestExecutor)

| # | Functionality | Description |
|---|---------------|--------------|
| 12.1 | Connection | Connect to MySQL (JDBC URL, user, password). |
| 12.2 | Insert test result | Insert row into test_results (timestamp, transaction_name, page_url, full_page_load_time, element_load_time, test_status). |
| 12.3 | Insert UEM result | TestExecutor.InsertdataInDB: insert full UEM row (run_id, timestamp, hostname, transaction_name, page_url, FCP, LCP, TBT, CLS, speed_index, performance_score, page_load_time, network/DNS/connection/server/response/browser/DOM times, element_load_time, test_status). |
| 12.4 | Close connection | AutoCloseable support for DatabaseManager. |

---

## 13. Utilities & Helpers

| # | Functionality | Description |
|---|---------------|--------------|
| 13.1 | Parse failure reason | Map exception message to user-facing reason (Timeout → "Element not Found", DOMException → "DOMException", else generic). |
| 13.2 | Take screenshot | Save page screenshot to ScreenshotDirectory with transaction name and timestamp in filename. |
| 13.3 | Get diagnostics from JSON | Read Lighthouse JSON file; extract audit diagnostics (title, description, etc.) for reporting. |

---

## Summary by Module

| Module | Main class(es) | # of functionalities |
|--------|----------------|------------------------|
| Entry & orchestration | Main | 12 |
| Configuration | ConfigurationManager | 2 |
| Run ID | RunIdManager | 4 |
| Crawling | URLCrawler | 11 |
| Browser | BrowserManager | 3 |
| Static/UEM execution | TestExecutor | 19 |
| Scripted execution | ScriptedTestExecutor | 29 |
| UI actions | Action | 11 |
| Test data (static) | TestDataManager | 4 |
| Test data (scripted) | ScriptedTestCaseManager | 3 |
| Reporting (static) | ResultReporter | 2 |
| Reporting (scripted) | Reporter | 4 |
| Lighthouse/UEM | TestExecutor, LighthouseRunner | 5 |
| Database | DatabaseManager, TestExecutor | 4 |
| Utilities | TestExecutor, ScriptedTestExecutor | 3 |

All of the above together define the functionality set of the current UI Performance Bot application.
