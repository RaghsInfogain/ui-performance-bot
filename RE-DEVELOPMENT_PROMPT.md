# UI Performance Bot — Re-Development Prompt

Use this prompt to re-develop the **UI Performance Bot** from scratch as a full-stack application with **Frontend**, **Backend**, and **Database**. The prompt is based on the existing Java/Playwright CLI application that runs UI performance tests and generates CSV reports.

---

## 1. Current Application Summary (Reference)

The existing application is a **Java/Maven CLI** that:

- Runs **UI performance tests** using **Playwright** (Chromium/Firefox/WebKit).
- Supports **two execution modes**:
  - **Scripted Flow**: Execute step-by-step UI scripts (navigate, click, type, etc.) with optional Navigation Timing and Lighthouse (UEM) metrics per step.
  - **Static / User Experience**: Visit a list of URLs (from CSV or from a **crawl**), measure page load and optional **Lighthouse (UEM)** metrics, and optionally wait for a specific element.
- Can **crawl a website** (same domain) and produce a CSV of URLs to use as the test case list.
- Generates **CSV reports** with run ID, timestamps, hostname, transaction/URL, and performance metrics (Navigation Timing + optional Lighthouse).
- Uses **config CSV** and **Properties** for paths and flags; **Run ID** is file-based; optional **MySQL** insert for results.

---

## 2. Functional Requirements for the New Application

### 2.1 Configuration

Support the following configuration (today in `config.csv` and Properties), manageable via **UI and/or API** and stored in **Database** where appropriate:

| Key | Purpose |
|-----|--------|
| `Headless_Mode` | Run browser headless (true/false) |
| `BrowserType` | chrome \| firefox \| webkit |
| `Test_Duration_Seconds` | Optional max test duration in seconds (e.g. 300); "NA" or 0 = no limit |
| `TakeScreenshot` | Capture screenshot on each page/step (true/false) |
| `ScriptedFlow` | Use scripted test cases (true) vs static URL list (false) |
| `UserExperience` | When true (static mode), collect Lighthouse/UEM metrics per URL |
| `AutoCrawl` | When true, crawl `CrawlerURL` first and use crawled URLs as test cases |
| `Think_Time` | Delay in ms between URLs/steps (e.g. 0) |
| `Multi_Threading` | Number of parallel threads for static URL execution (e.g. 1) |
| `CrawlerURL` | Start URL for crawler (e.g. https://example.com/) |

Additional path-like settings (today in Properties) should become **project/default paths or DB-backed settings**:

- Result directory (or “results stored in DB”)
- Config file path (or “config from DB”)
- User Experience / Static test case file path (or test case set ID from DB)
- Scripted test cases file path (or scripted test suite ID from DB)
- Screenshot directory
- Lighthouse CLI path (or use a standard install, e.g. `npx lighthouse`)

### 2.2 Crawling

- **Input**: A start URL (e.g. from `CrawlerURL`). Crawl only same-domain links.
- **Behavior**:
  - Use a crawler (e.g. HTTP + HTML parsing, or headless) to discover links.
  - Skip 404/403; optional SSL relaxation for testing.
  - Output: list of URLs with a generated **Transaction Name** (e.g. path or "Landing_Pages").
- **Output**: A **crawled URL list** that can be:
  - Saved in DB and associated with a **Run** or **Test Suite**.
  - Exported as CSV with columns: **Transaction Name**, **Path Page URL**, **Element Identifier**, **Element Selector** (crawler may leave selector columns empty).

### 2.3 Static / User Experience Mode (URL List)

- **Input**: A list of URLs (from crawl output or from a static test case list).
- **Per URL**:
  - Navigate to URL, wait for load (e.g. `load` event).
  - **Navigation Timing**: Collect and store (e.g. in DB and CSV export):
    - Page load time, network time, DNS lookup, connection time, server processing time, response time, browser time, DOM interactive, DOM complete.
  - Optional **element**: If an **Element Selector** is provided, wait for it and record **element load time**; use for PASS/FAIL.
  - If **UserExperience** is enabled: run **Lighthouse** (performance category) and record:
    - FCP, LCP, TBT, CLS, Speed Index, Performance Score.
    - Optionally store audit titles/scores/TBT savings (or a subset).
  - Optional **screenshot** if configured.
  - Apply **Think_Time** between URLs.
- **Concurrency**: Support **Multi_Threading** (N workers) when running many URLs.
- **Duration**: If `Test_Duration_Seconds` is set, stop after that duration; otherwise run through the list once (or as per design).

### 2.4 Scripted Flow Mode

- **Input**: **Scripted test cases** — each case has a name and an ordered list of **steps**.
- **Step fields** (conceptually from CSV): Test_Case_Name, Transaction_Name, Test_Steps, Request, Selector, Action, Parameter, Element to Wait, Element identifier, Frame_Selector, Timeout, etc.
- **Actions** to support (at least):
  - **Navigate** — open URL (Parameter = URL).
  - **Click**, **Set_Text**, **SelectOption**, **Check**, **Uncheck**, **Hover**, **PressKey** — use Selector (and Parameter for value).
  - **ThinkTime** — wait Parameter ms.
  - **WaitForSelector**, **WaitUntilElementIsVisible** — wait for selector (optional Timeout).
  - **CalculateFullPageLoadTime** — wait for load and record Navigation Timing.
  - **SwitchFrame** — switch to frame by selector.
  - **SwitchWindow** / **SwitchToNewTabAndGetText** / **ClickSwitchToNewTabAndGetText** — handle new window/tab and optionally get text from element.
  - **Get_Text** — get text from element (Element identifier).
- **Execution**: Playwright (or equivalent) runs steps in order; optionally run in a **loop** for `Test_Duration_Seconds` (similar to current Main loop).
- **Reporting**: For each step (or for steps that trigger a load):
  - Record **Navigation Timing** (page load time, network, DNS, etc.).
  - Optionally run **Lighthouse** and record FCP, LCP, TBT, CLS, Speed Index, Performance Score.
  - Record **Waiting Element Load Time** (time until element is visible).
  - **Test Status**: PASS/FAIL; **Failure Reason** (e.g. timeout, element not found).
- **Output**: Same kind of metrics as static mode (run ID, timestamp, hostname, transaction, step name, request, element, load times, status, Navigation + Lighthouse metrics), stored in DB and exportable as CSV.

### 2.5 Reporting and Export

- **Storage**: All runs and their results should be stored in the **Database** (not only in files).
- **CSV export**: Provide CSV export (via API and/or UI) that matches the current report format as closely as possible:
  - **Static/UEM run**: Run_ID, Timestamp, HostName, Transaction, Page URL, FCP, LCP, TBT, CLS, Speed Index, Performance Score, Page Load Time, Network Time, DNS Lookup Time, Connection Time, Server Processing Time, Response Time, Browser Time, DOM Interaction Time, DOM Complete Time, Playwright Full Page Load Time, Element Load Time, Test Status, Failure Reason, (optional) Audit Titles, Audit Scores, TBT Savings.
  - **Scripted run**: Run_ID, Timestamp, Transaction, HostName, Test Step Name, Request, Waiting Element, Waiting Element Load Time, Playwright Page Load Time, Test Status, Failure Reason, Page Load Time, Network Time, DNS Lookup Time, Connection Time, Server Processing Time, Response Time, Browser Time, DOM Interaction Time, DOM Complete Time, FCP, LCP, TBT, CLS, Speed Index, Performance Score.
- **Run ID**: Unique run identifier per execution (e.g. auto-increment or UUID), persisted in DB.

### 2.6 Additional Behaviors

- **Screenshots**: If enabled, save screenshots (e.g. to object storage or file path) and link them to the run/step in DB.
- **Lighthouse**: Run via CLI (e.g. `npx lighthouse … --output=json`) or programmatic API; parse JSON for performance category and audits. Prefer configurable path or standard `npx` so no hardcoded Windows paths.
- **Browser**: Support at least Chromium; optionally Firefox and WebKit. Headless/headed from config.
- **Failure handling**: Timeout → "Element not Found"; DOMException → "DOMException"; generic → "Some Error Occurred...". Store failure reason in DB and CSV.

---

## 3. Non-Functional and Architecture Requirements

### 3.1 Frontend

- **Technology**: Modern web stack (e.g. React, Vue, or Angular) with a clear, usable UI.
- **Features**:
  - **Configuration UI**: Edit and save execution settings (headless, browser, duration, crawl URL, scripted vs static, User Experience, think time, threads, etc.).
  - **Test case management**:
    - **Static**: Upload or define URL list (Transaction Name, URL, Element Selector); view/edit/delete.
    - **Scripted**: Create/edit scripted test cases and steps (action, selector, parameter, transaction, etc.).
  - **Crawl**: Trigger crawl for a URL; view and save crawled URLs as a test suite.
  - **Run execution**: Start a run (scripted or static, with or without crawl); show status (running / completed / failed).
  - **Results**: List runs with Run ID, date, mode, status; drill down into run details; **export CSV** for a run.
  - **Optional**: Dashboards (e.g. performance score over time, slowest pages).

### 3.2 Backend

- **Technology**: REST API (e.g. Node.js, Java/Spring, .NET, or Python/FastAPI). Must be able to:
  - Run **Playwright** (or equivalent) and **Lighthouse** (CLI or API) in a controlled environment (e.g. job queue, background worker).
- **Responsibilities**:
  - CRUD for configuration, test cases (static and scripted), crawled URL sets, and runs.
  - **Trigger crawl** → persist URLs and link to suite/run.
  - **Trigger test run** (scripted or static, with optional crawl first). Run in background; persist all metrics to DB.
  - **Export CSV** for a given run (from DB).
  - Serve run history and run details to the frontend.
- **Security**: Auth (e.g. login), authorization for runs and data; no hardcoded credentials; secure handling of config (e.g. Lighthouse path, DB connection).

### 3.3 Database

- **Technology**: Relational DB (e.g. PostgreSQL, MySQL) or equivalent.
- **Store**:
  - **Configuration**: Key-value or normalized table for execution settings (headless, browser, duration, crawl URL, flags, paths).
  - **Static test cases**: Suites and rows (transaction name, URL, element selector, etc.).
  - **Scripted test cases**: Test cases and steps (action, selector, parameter, transaction, frame, timeout, etc.).
  - **Crawled URL sets**: Crawl run ID, list of URLs with transaction names (and optional selectors).
  - **Runs**: Run ID, mode (scripted/static), status, start/end time, config snapshot or reference.
  - **Results**: One row per URL (static) or per step (scripted) with all metrics (Navigation Timing, Lighthouse, element load time, status, failure reason). Link to Run ID and optionally to screenshot.
- **Run ID**: Unique per run; generated by backend (e.g. sequence or UUID).

### 3.4 Execution Environment

- **Playwright**: Must be installed where the backend/worker runs (Node or Java bindings). Prefer a single recommended stack (e.g. Node + Playwright + Lighthouse CLI) to avoid path and env issues.
- **Lighthouse**: Use `npx lighthouse` or a configurable path; support headless Chrome flags (e.g. `--headless`, `--no-sandbox`) for server runs.
- **Crawler**: Can remain HTTP-based (e.g. Jsoup-like) or use Playwright for JS-rendered sites; same-domain and visit-once semantics.

---

## 4. Out of Scope / Simplifications (Optional)

- **DatabaseManager** in the current code: Optional; re-implementation can make DB the primary store and CSV export a view.
- **Lighthouse audit details**: Storing full audit titles/scores/TBT savings is optional; at least store FCP, LCP, TBT, CLS, Speed Index, Performance Score.
- **Re-run duration loop**: Scripted flow can be “run once” per execution; duration-based looping can be a later enhancement.
- **Multi-tenancy**: Single-tenant is enough unless specified otherwise.

---

## 5. Deliverables

1. **Frontend**: SPA with configuration, test case management (static + scripted), crawl trigger, run trigger, run list/detail, and CSV export.
2. **Backend**: REST API and job execution (crawl + scripted/static runs) with Playwright and Lighthouse integration; all results persisted to DB.
3. **Database**: Schema (migrations or scripts) for config, test cases, crawled sets, runs, and results.
4. **Documentation**: Short README for setup (env vars, DB, Playwright/Lighthouse install), run, and usage.
5. **CSV export**: At least one export format that matches the current Static and Scripted report columns so existing tooling/processes can be reused.

---

## 6. Reference: Current Data Structures (for parity)

**Config CSV (key, value rows):**  
`Headless_Mode`, `BrowserType`, `Test_Duration_Seconds`, `TakeScreenshot`, `ScriptedFlow`, `UserExperience`, `AutoCrawl`, `Think_Time`, `Multi_Threading`, `CrawlerURL`

**Static / Crawled test case CSV:**  
`Transaction Name`, `Path Page URL`, `Element Identifier`, `Element Selector`  
(Path Page URL can be comma-separated list in current StaticTestCases.)

**Scripted test case CSV:**  
`Test_Case_Name`, `Transaction_Name`, `Test_Steps`, `Object_Name`, `Request`, `Selector`, `Locator`, `Action`, `Parameter`, `Element to Wait`, `Element identifier`, `Frame_Selector`, `Timeout`, `Click_Selector` (for ClickSwitchToNewTabAndGetText)

**Static result CSV (UEM):**  
Run_ID, Timestamp, HostName, Transaction, Page URL, FCP, LCP, TBT, CLS, Speed Index, Performance Score, Page Load Time, Network Time, DNS Lookup Time, Connection Time, Server Processing Time, Response Time, Browser Time, DOM Interaction Time, DOM Complete Time, Playwright Full Page Load Time, Element Load Time, Test Status, Failure Reason, Audit Titles, Audit Scores, TBT Savings

**Scripted result CSV:**  
Run_ID, Timestamp, Transaction, HostName, Test Step Name, Request, Waiting Element, Waiting Element Load Time, Playwright Page Load Time, Test Status, Failure Reason, Page Load Time, Network Time, DNS Lookup Time, Connection Time, Server Processing Time, Response Time, Browser Time, DOM Interaction Time, DOM Complete Time, FCP, LCP, TBT, CLS, Speed Index, Performance Score

Use this prompt to implement the new application so that it preserves the behavior of the existing UI Performance Bot while adding a proper Frontend, Backend, and Database.
