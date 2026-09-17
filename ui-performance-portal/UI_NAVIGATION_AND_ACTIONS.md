# UI Performance Bot — Navigation & UI Actions Specification

This document defines the **information architecture**, **navigation map**, and **UI actions** for the web portal. Each action maps to a backend API endpoint for integration with the Java/Playwright engine.

---

## 1. Application Structure

```
┌─────────────────────────────────────────────────────────────────┐
│  Sidebar Navigation                                              │
├──────────────┬──────────────────────────────────────────────────┤
│ Dashboard    │  Overview, stats, quick actions, recent runs       │
│ Configuration│  Browser, duration, flags, paths                   │
│ Crawler      │  Discover URLs, export CSV, save suite              │
│ Test Cases   │  Static URL list + Scripted flow editor           │
│ Run Test     │  Wizard to start execution                        │
│ Run History  │  List, monitor, stop runs                         │
│ Reports      │  Results tables, filters, CSV export              │
└──────────────┴──────────────────────────────────────────────────┘
```

---

## 2. Navigation Map

| Route | Page | Primary User Goal |
|-------|------|-------------------|
| `/` | Dashboard | See status at a glance; jump to common tasks |
| `/configuration` | Configuration | Set browser, Lighthouse, crawl, threading |
| `/crawler` | Website Crawler | Discover URLs before testing |
| `/test-cases` | Test Cases | Manage static URLs and scripted steps |
| `/run-test` | Run Test | Start a new performance run |
| `/runs` | Run History | Monitor and stop runs |
| `/runs/:runId` | Run Detail | Drill into one run’s results |
| `/reports` | Reports | Analyze metrics and export CSV |

---

## 3. UI Actions by Module

### 3.1 Dashboard (`/`)

| UI Action | User Interaction | Backend API | Maps to Module |
|-----------|------------------|-------------|----------------|
| View summary stats | Page load | `GET /api/runs/stats` | RunIdManager, TestExecutor |
| View recent runs | Table row click → Run Detail | `GET /api/runs?limit=5` | RunIdManager |
| **Quick: New Run** | Button → `/run-test` | — | Main |
| **Quick: Crawl Site** | Button → `/crawler` | — | URLCrawler |
| **Quick: Edit Config** | Button → `/configuration` | — | ConfigurationManager |
| View all runs | Link → `/runs` | `GET /api/runs` | RunIdManager |

---

### 3.2 Configuration (`/configuration`)

| UI Action | User Interaction | Backend API | Maps to Module |
|-----------|------------------|-------------|----------------|
| Load config | Page load | `GET /api/config` | ConfigurationManager, Properties |
| Edit browser type | Dropdown: chrome / firefox / webkit | — | BrowserManager |
| Toggle headless | Checkbox | — | BrowserManager |
| Set test duration | Number input (0 = no limit) | — | Main, TestExecutor |
| Set multi-threading | Number input | — | TestExecutor |
| Set think time | Number input (ms) | — | TestExecutor, ScriptedTestExecutor |
| Toggle take screenshot | Checkbox | — | TestExecutor |
| Toggle scripted flow | Checkbox | — | Main |
| Toggle user experience (Lighthouse) | Checkbox | — | TestExecutor (UEM) |
| Toggle auto crawl | Checkbox | — | Main, URLCrawler |
| Set crawler URL | URL input | — | URLCrawler |
| Set result / screenshot paths | Text inputs | — | Properties |
| **Save configuration** | Save button | `PUT /api/config` + validate | ConfigurationManager |
| Validate config | On save | `POST /api/config/validate` | Main (URL validation) |

---

### 3.3 Website Crawler (`/crawler`)

| UI Action | User Interaction | Backend API | Maps to Module |
|-----------|------------------|-------------|----------------|
| Enter start URL | URL input | — | URLCrawler |
| **Start crawl** | Button | `POST /api/crawl { startUrl }` | URLCrawler (4.1–4.11) |
| View crawl progress | Status indicator (polling/WebSocket) | `GET /api/crawl/:id/status` | URLCrawler |
| View discovered URLs | Table | `GET /api/crawl/:id/urls` | URLCrawler (4.8) |
| **Export crawled CSV** | Button | `GET /api/crawl/:id/export.csv` | URLCrawler (4.8) |
| Save as test suite | Name + Save | `POST /api/test-suites` | URLCrawler (4.10) |
| **Run tests on URLs** | Button → `/run-test` | — | Main → TestExecutor |

---

### 3.4 Test Cases (`/test-cases`)

#### Static URL List tab

| UI Action | User Interaction | Backend API | Maps to Module |
|-----------|------------------|-------------|----------------|
| View static cases | Table on load | `GET /api/test-cases/static` | TestDataManager |
| Add row | Add Row button | `POST /api/test-cases/static` | TestDataManager |
| Edit row inline | Cell inputs | `PUT /api/test-cases/static/:id` | TestDataManager |
| Delete row | Trash icon | `DELETE /api/test-cases/static/:id` | TestDataManager |
| **Import CSV** | File upload | `POST /api/test-cases/static/import` | TestDataManager |

#### Scripted Flows tab

| UI Action | User Interaction | Backend API | Maps to Module |
|-----------|------------------|-------------|----------------|
| Select test case | Sidebar list | `GET /api/test-cases/scripted` | ScriptedTestCaseManager |
| View steps | Table | — | ScriptedTestCaseManager |
| Add / edit step | Step editor (future) | `PUT /api/test-cases/scripted` | ScriptedTestExecutor, Action |
| **Save scripted suite** | Save button | `PUT /api/test-cases/scripted` | ScriptedTestCaseManager |

**Scripted actions supported in UI/backend:** Navigate, Click, Set_Text, WaitForSelector, SelectOption, Check, Uncheck, Hover, PressKey, ThinkTime, CalculateFullPageLoadTime, SwitchFrame, SwitchWindow, Get_Text, ClickSwitchToNewTabAndGetText, SwitchToNewTabAndGetText, WaitUntilElementIsVisible.

---

### 3.5 Run Test (`/run-test`)

| UI Action | User Interaction | Backend API | Maps to Module |
|-----------|------------------|-------------|----------------|
| Select mode | Static vs Scripted cards | — | Main (1.5) |
| Select data source | Crawled / Static / Scripted radio | — | TestExecutor (6.1) |
| Toggle auto crawl | Checkbox | — | Main (1.6) |
| Review execution summary | Read-only config snapshot | `GET /api/config` | ConfigurationManager |
| **Start test run** | Button | `POST /api/runs { mode, options }` | Main, TestExecutor, ScriptedTestExecutor |
| Redirect to run detail | Auto after start | `GET /api/runs/:runId` | RunIdManager |

---

### 3.6 Run History (`/runs`)

| UI Action | User Interaction | Backend API | Maps to Module |
|-----------|------------------|-------------|----------------|
| List all runs | Table on load | `GET /api/runs` | RunIdManager |
| Filter by status | Dropdown (future) | `GET /api/runs?status=` | — |
| View progress bar | Per-row progress | `GET /api/runs/:id` (poll) | TestExecutor |
| **View run** | Button → Run Detail | `GET /api/runs/:runId` | RunIdManager |
| **Stop run** | Stop button (active runs) | `POST /api/runs/:runId/stop` | TestExecutor (stop flag) |
| New run | Header button → `/run-test` | — | Main |

---

### 3.7 Run Detail (`/runs/:runId`)

| UI Action | User Interaction | Backend API | Maps to Module |
|-----------|------------------|-------------|----------------|
| View run metadata | Cards: status, progress, pass/fail | `GET /api/runs/:runId` | RunIdManager |
| View static/UEM results | Table | `GET /api/runs/:runId/results/static` | ResultReporter, TestExecutor |
| View scripted results | Table | `GET /api/runs/:runId/results/scripted` | Reporter |
| View Lighthouse JSON | Row expand (future) | `GET /api/runs/:runId/lighthouse?url=` | LighthouseRunner |
| **Export CSV** | Button | `GET /api/runs/:runId/export.csv` | ResultReporter, Reporter |
| Open full report | Link → `/reports?runId=` | — | — |

---

### 3.8 Reports (`/reports`)

| UI Action | User Interaction | Backend API | Maps to Module |
|-----------|------------------|-------------|----------------|
| Select run ID | Dropdown | `GET /api/runs` | RunIdManager |
| Filter pass/fail | Dropdown | Client-side filter | — |
| View aggregate stats | Summary cards | Computed from results | — |
| View full metrics table | Scrollable table | `GET /api/runs/:runId/results/static` | TestExecutor (UEM CSV columns) |
| **Export CSV** | Button | `GET /api/runs/:runId/export.csv` | Static_Run_Report / ScriptedFlow CSV |

**Static report columns exposed:** Run ID, Timestamp, HostName, Transaction, Page URL, FCP, LCP, TBT, CLS, Speed Index, Performance Score, Page Load Time, Network/DNS/Connection/Server/Response/Browser/DOM times, Element Load Time, Test Status, Failure Reason.

**Scripted report columns:** Run ID, Timestamp, Transaction, HostName, Test Step Name, Request, Waiting Element, Load Times, Navigation Timing, Lighthouse fields, Test Status, Failure Reason.

---

## 4. User Journey Flows

### Flow A: Crawl → Test → Report (most common)

```
Dashboard → Crawler → [Start Crawl] → [Export/Save Suite]
    → Run Test → [Static + Auto Crawl + Lighthouse] → [Start]
    → Run Detail (live) → Reports → [Export CSV]
```

### Flow B: Static URL list (no crawl)

```
Test Cases → [Add/Import URLs]
    → Configuration → [UserExperience=ON, AutoCrawl=OFF]
    → Run Test → [Static source] → Run Detail → Reports
```

### Flow C: Scripted user journey

```
Test Cases → Scripted tab → [Edit steps]
    → Configuration → [ScriptedFlow=ON]
    → Run Test → [Scripted mode] → Run Detail → Reports
```

### Flow D: Monitor & stop long run

```
Runs → [View running run] → Run Detail
    OR Runs → [Stop] on active row
```

---

## 5. Backend Integration Contract (summary)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/config` | Load configuration |
| PUT | `/api/config` | Save configuration |
| POST | `/api/config/validate` | Validate before run |
| GET | `/api/test-cases/static` | List static test cases |
| POST/PUT/DELETE | `/api/test-cases/static` | CRUD static cases |
| GET/PUT | `/api/test-cases/scripted` | List/save scripted steps |
| POST | `/api/crawl` | Start crawl job |
| GET | `/api/crawl/:id/urls` | Get crawled URLs |
| GET | `/api/crawl/:id/export.csv` | Download crawled CSV |
| POST | `/api/runs` | Start test run (async job) |
| GET | `/api/runs` | List runs |
| GET | `/api/runs/:id` | Run status & metadata |
| POST | `/api/runs/:id/stop` | Stop running test |
| GET | `/api/runs/:id/results/static` | Static/UEM result rows |
| GET | `/api/runs/:id/results/scripted` | Scripted result rows |
| GET | `/api/runs/:id/export.csv` | Download result CSV |
| GET | `/api/runs/:id/lighthouse` | Lighthouse JSON per URL |

---

## 6. Module → Screen Mapping

| Backend Module | Primary UI Screen(s) |
|----------------|----------------------|
| Main | Run Test, Dashboard |
| ConfigurationManager | Configuration |
| RunIdManager | Runs, Run Detail, Reports |
| URLCrawler | Crawler |
| BrowserManager | Configuration |
| TestExecutor | Run Test, Run Detail, Reports |
| ScriptedTestExecutor | Test Cases (scripted), Run Detail |
| Action | Test Cases (scripted step editor) |
| TestDataManager | Test Cases (static) |
| ScriptedTestCaseManager | Test Cases (scripted) |
| ResultReporter / Reporter | Run Detail, Reports |
| LighthouseRunner | Run Detail, Reports (UEM columns) |
| DatabaseManager | All (via API persistence) |

---

## 7. Running the UI

```bash
cd ui-performance-portal
npm install
npm run dev
```

Open **http://localhost:5173**. The portal uses mock data in `src/services/api.ts`; replace with `fetch()` calls to your backend when ready.
