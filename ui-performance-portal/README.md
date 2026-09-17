# UI Performance Portal

Web UI for the **UI Performance Bot** with a **real backend** for crawling and test execution.

## Important: two processes required

The UI needs **both** the API server and the Vite frontend running:

### Terminal 1 — API server (crawl + Java test runner)

```bash
cd ui-performance-portal
npm install
npm run server
```

You should see: `UI Performance Bot API running at http://localhost:3002`

### Terminal 2 — Web UI

```bash
cd ui-performance-portal
npm run dev
```

Open **http://localhost:5173**

A green banner **"API server connected"** means crawl and runs will work.  
A red banner means Terminal 1 is not running.

---

## What works now

| Feature | How it works |
|---------|----------------|
| **Crawl** | Node backend crawls URLs (cheerio), writes `Results/crawled_urls_<runId>.csv` |
| **Run test** | Backend updates `config.csv` and spawns `mvn exec:java` (Java Playwright engine) |
| **Results** | Reads `Results/Static_RunID_<id>/Static_Run_Report_*.csv` live (polls every 5s) |
| **Configuration** | Reads/writes `config.csv` in project root |

## Requirements

- **Node.js 18+** (for UI + API server)
- **Java 8+** and **Maven** (for test execution)
- **Node.js + npx** (for Lighthouse when User Experience is enabled)

## Typical workflow

1. Start both terminals (server + dev)
2. **Configuration** — set browser, Lighthouse, crawler URL
3. **Website Crawler** — Start Crawl → wait for URLs → Export or Run Tests
4. **Run Test** — choose crawled URLs or Auto Crawl → Start Test Run
5. **Run Detail** — watch results appear; **Reports** → export CSV

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Red "API server not running" banner | Run `npm run server` in Terminal 1 |
| Crawl does nothing | Check API server terminal for errors |
| Run starts but no results | Ensure Maven/Java installed; check Terminal 1 logs for `[Run xxxx]` |
| Lighthouse fails | Install Node; run `npx lighthouse --version` |
