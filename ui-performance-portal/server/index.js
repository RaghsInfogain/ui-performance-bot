import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import * as cheerio from 'cheerio';
import { parseCsvFile as parseCsvFromDisk, parseCsvContent, parseUemResultRows, countUrlsInCsvFile, countRowsInCsvFile } from './csvUtils.js';
import { listScripts, getScript, saveScript, deleteScript, renameScript, syncLegacyScripts, importCrawledScript } from './scriptsStore.js';
import { startRecorder, stopRecorder, cancelRecorder, getRecorderStatus } from './recorder.js';
import { buildRunReport } from './reportAnalysis.js';
import { generateRunReport } from './runReport.js';
import { signup, login, logout, me } from './authStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(__dirname, '../..');
const JAVA_PROJECT = path.join(WORKSPACE_ROOT, 'PlaywrightLoadTest_v3');
const CONFIG_CSV = path.join(WORKSPACE_ROOT, 'config.csv');
const STATIC_CSV = path.join(WORKSPACE_ROOT, 'StaticTestCases.csv');
const SCRIPTED_CSV = path.join(WORKSPACE_ROOT, 'ScriptedTestCasesFilePath.csv');
const RESULTS_DIR = path.join(WORKSPACE_ROOT, 'Results');
const RUN_ID_FILE = path.join(JAVA_PROJECT, 'runId.txt');
const PROPERTIES_FILE = path.join(JAVA_PROJECT, 'src/test/resources/Properties.properties');

const MAX_CRAWL_PAGES = 50;
const FETCH_TIMEOUT_MS = 12000;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const CRAWL_MAX_DURATION_MS = 120000; // 2 minutes max
const PORT = process.env.PORT || 3002;

const app = express();
app.use(cors());
app.use(express.json());

/** @type {Map<string, { status: string, urls: object[], error?: string, startUrl: string }>} */
const crawlJobs = new Map();

/** @type {Map<string, { pid: number, child: import('child_process').ChildProcess, startedAt: string, mode: string }>} */
const activeRuns = new Map();

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getNextRunId() {
  let current = '0001';
  if (fs.existsSync(RUN_ID_FILE)) {
    current = fs.readFileSync(RUN_ID_FILE, 'utf8').trim() || '0000';
  }
  const next = String(parseInt(current, 10) + 1).padStart(4, '0');
  fs.writeFileSync(RUN_ID_FILE, next);
  return next;
}

function readConfigCsv() {
  if (!fs.existsSync(CONFIG_CSV)) return {};
  const map = {};
  for (const line of fs.readFileSync(CONFIG_CSV, 'utf8').split('\n')) {
    const [k, ...rest] = line.split(',');
    if (k?.trim()) map[k.trim()] = rest.join(',').trim();
  }
  return map;
}

function writeConfigCsv(raw) {
  const lines = [
    `Headless_Mode,${raw.Headless_Mode ?? 'TRUE'}`,
    `BrowserType,${raw.BrowserType ?? 'chrome'}`,
    `Test_Duration_Seconds,${raw.Test_Duration_Seconds ?? '300'}`,
    `TakeScreenshot,${raw.TakeScreenshot ?? 'FALSE'}`,
    `ScriptedFlow,${raw.ScriptedFlow ?? 'FALSE'}`,
    `UserExperience,${raw.UserExperience ?? 'TRUE'}`,
    `AutoCrawl,${raw.AutoCrawl ?? 'FALSE'}`,
    `Think_Time,${raw.Think_Time ?? '0'}`,
    `Multi_Threading,${raw.Multi_Threading ?? '1'}`,
    `CrawlerURL,${raw.CrawlerURL ?? ''}`,
  ];
  fs.writeFileSync(CONFIG_CSV, lines.join('\n') + '\n');
}

function configToApi(raw) {
  return {
    headlessMode: (raw.Headless_Mode ?? 'TRUE').toUpperCase() === 'TRUE',
    browserType: (raw.BrowserType ?? 'chrome').toLowerCase(),
    testDurationSeconds: raw.Test_Duration_Seconds && raw.Test_Duration_Seconds !== 'NA' && raw.Test_Duration_Seconds !== '0'
      ? Number(raw.Test_Duration_Seconds) : null,
    takeScreenshot: (raw.TakeScreenshot ?? 'FALSE').toUpperCase() === 'TRUE',
    scriptedFlow: (raw.ScriptedFlow ?? 'FALSE').toUpperCase() === 'TRUE',
    userExperience: (raw.UserExperience ?? 'TRUE').toUpperCase() === 'TRUE',
    autoCrawl: (raw.AutoCrawl ?? 'FALSE').toUpperCase() === 'TRUE',
    thinkTime: Number(raw.Think_Time ?? 0),
    multiThreading: Number(raw.Multi_Threading ?? 1),
    crawlerUrl: raw.CrawlerURL ?? '',
    resultDirectory: '../Results',
    screenshotDirectory: '../screenshots',
  };
}

function apiToConfig(api) {
  return {
    Headless_Mode: api.headlessMode ? 'TRUE' : 'FALSE',
    BrowserType: api.browserType,
    Test_Duration_Seconds: api.testDurationSeconds ?? '0',
    TakeScreenshot: api.takeScreenshot ? 'TRUE' : 'FALSE',
    ScriptedFlow: api.scriptedFlow ? 'TRUE' : 'FALSE',
    UserExperience: api.userExperience ? 'TRUE' : 'FALSE',
    AutoCrawl: api.autoCrawl ? 'TRUE' : 'FALSE',
    Think_Time: String(api.thinkTime ?? 0),
    Multi_Threading: String(api.multiThreading ?? 1),
    CrawlerURL: api.crawlerUrl ?? '',
  };
}

function updateProperties(updates) {
  let content = '';
  if (fs.existsSync(PROPERTIES_FILE)) content = fs.readFileSync(PROPERTIES_FILE, 'utf8');
  const lines = content.split('\n').filter((l) => l && !l.startsWith('#'));
  const map = {};
  for (const line of lines) {
    const idx = line.indexOf('=');
    if (idx > 0) map[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  Object.assign(map, updates);
  const out = Object.entries(map).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  fs.writeFileSync(PROPERTIES_FILE, out);
}

function parseCsvFile(filePath) {
  return parseCsvFromDisk(filePath, fs);
}

function sameHostname(url, host) {
  try { return new URL(url).hostname === host; } catch { return false; }
}

function transactionNameFromUrl(url) {
  try {
    const pathPart = url.replace(/^https?:\/\/[^/]+\//, '');
    return pathPart || 'Landing_Pages';
  } catch {
    return 'Landing_Pages';
  }
}

async function crawlWebsite(startUrl, crawlRunId) {
  const job = crawlJobs.get(crawlRunId);
  const startHost = new URL(startUrl).hostname;
  const visited = new Set();
  const discovered = new Set();
  const queued = new Set();
  const queue = [startUrl.split('#')[0]];
  const deadline = Date.now() + CRAWL_MAX_DURATION_MS;
  const csvPath = path.join(RESULTS_DIR, `crawled_urls_${crawlRunId}.csv`);
  const header = 'Transaction Name,Path Page URL,Element Identifier,Element Selector\n';
  fs.writeFileSync(csvPath, header);
  job.pagesVisited = 0;

  const appendRow = (pageUrl) => {
    if (discovered.has(pageUrl)) return;
    discovered.add(pageUrl);
    fs.appendFileSync(csvPath, `${transactionNameFromUrl(pageUrl)},${pageUrl},,\n`);
    job.urlsFound = discovered.size;
  };

  appendRow(startUrl.split('#')[0]);

  try {
    while (queue.length > 0 && visited.size < MAX_CRAWL_PAGES && Date.now() < deadline) {
      if (job.status === 'cancelled') break;
      const url = queue.shift();
      if (!url || visited.has(url) || !sameHostname(url, startHost)) continue;

      visited.add(url);
      job.pagesVisited = visited.size;

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        const res = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Referer: 'https://www.google.com',
          },
          redirect: 'follow',
        });
        clearTimeout(timer);

        if (res.status === 404 || res.status === 403) continue;

        const buf = await res.arrayBuffer();
        if (buf.byteLength > MAX_HTML_BYTES) continue;

        const html = Buffer.from(buf).toString('utf8');
        const $ = cheerio.load(html);

        $('a[href]').each((_, el) => {
          const href = $(el).attr('href');
          if (!href) return;
          try {
            const abs = new URL(href, url).href.split('#')[0];
            if (!sameHostname(abs, startHost)) return;
            appendRow(abs);
            if (!visited.has(abs) && !queued.has(abs)) {
              queued.add(abs);
              queue.push(abs);
            }
          } catch { /* skip */ }
        });
      } catch (err) {
        console.error('Crawl error for', url, err.message);
      }
    }
  } finally {
    updateProperties({ testCaseFiles: csvPath });
    job.status = 'completed';
    job.urlsFound = discovered.size;
    job.completedAt = new Date().toISOString();
    try {
      importCrawledScript(crawlRunId, `Crawled URLs (Run ${crawlRunId})`, csvPath);
    } catch (err) {
      console.error('Failed to save crawled URLs as script:', err.message);
    }
    console.log(`Crawl ${crawlRunId} done: ${discovered.size} URLs, ${visited.size} pages visited`);
  }
}

function runMetaPath(runId) {
  return path.join(RESULTS_DIR, `Static_RunID_${runId}`, 'run-meta.json');
}

function readRunMeta(runId) {
  const p = runMetaPath(runId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function writeRunMeta(runId, meta) {
  const dir = path.join(RESULTS_DIR, `Static_RunID_${runId}`);
  ensureDir(dir);
  fs.writeFileSync(runMetaPath(runId), JSON.stringify(meta, null, 2));
}

function markRunCompleted(runId, exitCode = 0) {
  const existing = readRunMeta(runId) ?? { runId };
  const status = existing.status === 'stopped'
    ? 'stopped'
    : (exitCode === 0 ? 'completed' : 'failed');
  writeRunMeta(runId, {
    ...existing,
    status,
    endedAt: existing.endedAt ?? new Date().toISOString(),
    exitCode,
  });
}

function resolveRunStatus(runId, meta) {
  if (activeRuns.has(runId)) {
    return 'running';
  }
  return meta?.status ?? 'completed';
}

function countUrlsInTestFile(filePath) {
  return countUrlsInCsvFile(filePath, fs);
}

function crawledCsvPath(crawlRunId) {
  return path.join(RESULTS_DIR, `crawled_urls_${crawlRunId}.csv`);
}

function loadCrawledUrlsFromCsv(crawlRunId) {
  const csvPath = crawledCsvPath(crawlRunId);
  if (!fs.existsSync(csvPath)) return [];
  const { data: rows } = parseCsvFile(csvPath);
  return rows.map((r, i) => ({
    id: String(i + 1),
    transactionName: r['Transaction Name'] ?? '',
    pageUrl: r['Path Page URL'] ?? '',
    elementIdentifier: r['Element Identifier'] ?? '',
    elementSelector: r['Element Selector'] ?? '',
    crawlRunId,
  }));
}

function resolveUrlsTotal({ scriptId, testSuite, crawlRunId, mode }) {
  if (scriptId) {
    const script = getScript(scriptId);
    if (!script?.filePath) return 0;
    return script.type === 'static'
      ? countUrlsInCsvFile(script.filePath, fs)
      : countRowsInCsvFile(script.filePath, fs);
  }
  if (testSuite === 'crawled' && crawlRunId) {
    return countUrlsInTestFile(crawledCsvPath(crawlRunId));
  }
  if (mode === 'static') {
    return countUrlsInTestFile(STATIC_CSV);
  }
  if (mode === 'scripted') {
    return countRowsInCsvFile(SCRIPTED_CSV, fs);
  }
  return 0;
}

function resolveUrlsTotalFromMeta(meta) {
  if (!meta) return 0;
  if (meta.scriptId) {
    return resolveUrlsTotal({ scriptId: meta.scriptId, mode: meta.mode ?? 'static' });
  }
  if (meta.crawlRunId) {
    return countUrlsInTestFile(crawledCsvPath(meta.crawlRunId));
  }
  if (meta.mode === 'scripted') {
    return countRowsInCsvFile(SCRIPTED_CSV, fs);
  }
  if (meta.mode === 'static') {
    return countUrlsInTestFile(STATIC_CSV);
  }
  return 0;
}

function mapUemRow(runId, r) {
  return {
    runId,
    timestamp: r.Timestamp ?? '',
    hostname: r.HostName ?? '',
    transaction: r.Transaction ?? '',
    pageUrl: r['Page URL'] ?? '',
    fcp: Number(r['First Contentful Paint'] ?? 0),
    lcp: Number(r['Last Contentful Paint'] ?? 0),
    tbt: Number(r['Total Blocking Time'] ?? 0),
    cls: Number(r['Cumulative Layout Shift'] ?? 0),
    speedIndex: Number(r['Speed Index'] ?? 0),
    performanceScore: Number(r['Performance Score'] ?? 0),
    pageLoadTime: Number(r['Page Load Time'] ?? 0),
    networkTime: Number(r['Network Time'] ?? 0),
    dnsLookupTime: Number(r['DNS Lookup Time'] ?? 0),
    connectionTime: Number(r['Connection Time'] ?? 0),
    serverProcessingTime: Number(r['Server Processing Time'] ?? 0),
    responseTime: Number(r['Response Time'] ?? 0),
    browserTime: Number(r['Browser Time'] ?? 0),
    domInteractionTime: Number(r['DOM Interaction Time'] ?? 0),
    domCompleteTime: Number(r['DOM Complete Time'] ?? 0),
    playwrightPageLoadTime: Number(r['Playwright Full Page Load Time'] ?? 0),
    elementLoadTime: r['Element Load Time'] ?? 'N/A',
    testStatus: String(r['Test Status'] ?? 'PASS').includes('FAIL') ? 'FAIL' : 'PASS',
    failureReason: r['Failure Reason'] ?? '',
  };
}

function parseProgressResults(runId) {
  const progressPath = path.join(RESULTS_DIR, `Static_RunID_${runId}`, 'run-progress.jsonl');
  if (!fs.existsSync(progressPath)) return [];
  const lines = fs.readFileSync(progressPath, 'utf8').split('\n').filter(Boolean);
  const byUrl = new Map();
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (!entry.pageUrl) continue;
      byUrl.set(entry.pageUrl, {
        runId,
        timestamp: entry.timestamp ?? '',
        hostname: os.hostname(),
        transaction: entry.transaction ?? '',
        pageUrl: entry.pageUrl,
        fcp: 0,
        lcp: 0,
        tbt: 0,
        cls: 0,
        speedIndex: 0,
        performanceScore: Number(entry.performanceScore ?? 0),
        pageLoadTime: Number(entry.pageLoadTime ?? 0),
        networkTime: 0,
        dnsLookupTime: 0,
        connectionTime: 0,
        serverProcessingTime: 0,
        responseTime: 0,
        browserTime: 0,
        domInteractionTime: 0,
        domCompleteTime: 0,
        playwrightPageLoadTime: Number(entry.pageLoadTime ?? 0),
        elementLoadTime: entry.elementLoadTime ?? 'N/A',
        testStatus: entry.testStatus === 'FAIL' ? 'FAIL' : 'PASS',
        failureReason: entry.failureReason ?? '',
      });
    } catch {
      /* skip malformed line */
    }
  }
  return [...byUrl.values()];
}

function dedupeResultsByUrl(results) {
  const byUrl = new Map();
  for (const r of results) {
    if (r.pageUrl) byUrl.set(r.pageUrl, r);
  }
  return [...byUrl.values()];
}

function parseCsvResultsOnly(runId) {
  const reportPath = path.join(RESULTS_DIR, `Static_RunID_${runId}`, `Static_Run_Report_RunID_${runId}.csv`);
  if (!fs.existsSync(reportPath)) return [];
  const content = fs.readFileSync(reportPath, 'utf8');
  const rows = parseUemResultRows(content);
  return dedupeResultsByUrl(rows.map((r) => mapUemRow(runId, r)));
}

function parseStaticResults(runId) {
  const csvResults = parseCsvResultsOnly(runId);
  const progressResults = parseProgressResults(runId);
  const byUrl = new Map();
  for (const r of progressResults) byUrl.set(r.pageUrl, r);
  for (const r of csvResults) byUrl.set(r.pageUrl, r);
  return [...byUrl.values()].sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
}

function buildRunSummary(runId, mode = 'static') {
  const meta = readRunMeta(runId);
  const results = parseStaticResults(runId);
  const passCount = results.filter((r) => r.testStatus === 'PASS').length;
  const failCount = results.filter((r) => r.testStatus === 'FAIL').length;
  const scores = results.map((r) => r.performanceScore).filter((s) => s > 0);
  const urlsTotal = resolveUrlsTotalFromMeta(meta) || meta?.urlsTotal || results.length || 0;

  return {
    id: `${mode}-${runId}`,
    runId,
    mode: meta?.mode ?? mode,
    status: resolveRunStatus(runId, meta),
    startedAt: meta?.startedAt ?? results[0]?.timestamp ?? '',
    endedAt: meta?.endedAt ?? (results.length ? results[results.length - 1].timestamp : undefined),
    hostname: results[0]?.hostname ?? meta?.hostname ?? '',
    configSnapshot: meta?.configSnapshot ?? configToApi(readConfigCsv()),
    testDurationSeconds: meta?.testDurationSeconds ?? null,
    multiThreading: meta?.multiThreading ?? 1,
    urlsTotal,
    urlsCompleted: results.length,
    passCount,
    failCount,
    avgPerformanceScore: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : undefined,
    crawlRunId: meta?.crawlRunId ?? undefined,
    scriptId: meta?.scriptId ?? undefined,
  };
}

function listRunsFromDisk() {
  ensureDir(RESULTS_DIR);
  const runs = [];
  const seen = new Set();

  const dirs = fs.readdirSync(RESULTS_DIR, { withFileTypes: true });
  for (const d of dirs) {
    if (!d.isDirectory() || !d.name.startsWith('Static_RunID_')) continue;
    const runId = d.name.replace('Static_RunID_', '');
    seen.add(runId);
    runs.push(buildRunSummary(runId, 'static'));
  }

  for (const d of fs.readdirSync(RESULTS_DIR)) {
    if (!d.includes('ScriptedFlow_Test_') || !d.endsWith('_Results.csv')) continue;
    const m = d.match(/ScriptedFlow_Test_(\d+)_Results/);
    if (!m) continue;
    const runId = m[1];
    if (seen.has(runId)) continue;
    seen.add(runId);
    const meta = readRunMeta(runId);
    runs.push({
      id: `scripted-${runId}`,
      runId,
      mode: 'scripted',
      status: resolveRunStatus(runId, meta),
      startedAt: meta?.startedAt ?? '',
      endedAt: meta?.endedAt,
      hostname: meta?.hostname ?? '',
      configSnapshot: meta?.configSnapshot ?? {},
      testDurationSeconds: meta?.testDurationSeconds ?? null,
      multiThreading: meta?.multiThreading ?? 1,
      urlsTotal: meta?.urlsTotal ?? 0,
      urlsCompleted: 0,
      passCount: 0,
      failCount: 0,
    });
  }

  for (const [runId, meta] of activeRuns) {
    if (!seen.has(runId)) {
      runs.unshift({
        id: `active-${runId}`,
        runId,
        mode: meta.mode,
        status: resolveRunStatus(runId, readRunMeta(runId)),
        startedAt: meta.startedAt,
        hostname: 'localhost',
        configSnapshot: readRunMeta(runId)?.configSnapshot ?? configToApi(readConfigCsv()),
        testDurationSeconds: readRunMeta(runId)?.testDurationSeconds ?? null,
        multiThreading: readRunMeta(runId)?.multiThreading ?? 1,
        urlsTotal: readRunMeta(runId)?.urlsTotal ?? 0,
        urlsCompleted: parseStaticResults(runId).length,
        passCount: 0,
        failCount: 0,
      });
    }
  }

  return runs.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
}

function syncRunPropertiesBeforeStart() {
  updateProperties({
    configFilePath: CONFIG_CSV,
    ResultDirectory: RESULTS_DIR,
    ScreenshotDirectory: path.join(WORKSPACE_ROOT, 'screenshots'),
  });
}

function buildJavaRunEnv() {
  const uiPortalDir = path.join(WORKSPACE_ROOT, 'ui-performance-portal');
  const lighthouseBin = path.join(
    uiPortalDir,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'lighthouse.cmd' : 'lighthouse',
  );
  const npmCache = path.join(WORKSPACE_ROOT, '.npm-cache');
  if (!fs.existsSync(npmCache)) fs.mkdirSync(npmCache, { recursive: true });
  const portalBin = path.join(uiPortalDir, 'node_modules', '.bin');
  return {
    ...process.env,
    LIGHTHOUSE_BIN: fs.existsSync(lighthouseBin) ? lighthouseBin : '',
    NPM_CONFIG_CACHE: npmCache,
    PATH: `${portalBin}${path.delimiter}${process.env.PATH || ''}`,
  };
}

function spawnJavaRun(runId, mode) {
  const mvn = process.platform === 'win32' ? 'mvn.cmd' : 'mvn';
  const child = spawn(mvn, ['-q', 'test-compile', 'exec:java', '-Dexec.mainClass=PlaywrightUIPageload.Main'], {
    cwd: JAVA_PROJECT,
    env: buildJavaRunEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (d) => console.log(`[Run ${runId}]`, d.toString()));
  child.stderr?.on('data', (d) => console.error(`[Run ${runId}]`, d.toString()));
  child.on('close', (code) => {
    console.log(`[Run ${runId}] finished with code`, code);
    markRunCompleted(runId, code ?? 0);
    activeRuns.delete(runId);
  });

  activeRuns.set(runId, {
    pid: child.pid,
    child,
    startedAt: new Date().toISOString(),
    mode,
  });
}

// ── Routes ─────────────────────────────────────────────────────

// ── Routes ─────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    workspace: WORKSPACE_ROOT,
    javaProject: fs.existsSync(JAVA_PROJECT),
    config: fs.existsSync(CONFIG_CSV),
  });
});

app.post('/api/auth/signup', (req, res) => {
  try {
    res.json(signup(req.body ?? {}));
  } catch (err) {
    res.status(400).json({ error: err.message || 'Signup failed' });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    res.json(login(req.body ?? {}));
  } catch (err) {
    res.status(401).json({ error: err.message || 'Login failed' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  res.json(logout(token));
});

app.get('/api/auth/me', (req, res) => {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const user = me(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json(user);
});

app.get('/api/config', (_req, res) => {
  res.json(configToApi(readConfigCsv()));
});

app.put('/api/config', (req, res) => {
  writeConfigCsv(apiToConfig(req.body));
  res.json(configToApi(readConfigCsv()));
});

app.post('/api/config/validate', (req, res) => {
  const errors = [];
  const c = req.body;
  if (c.autoCrawl && !c.crawlerUrl) errors.push('Crawler URL is required when Auto Crawl is enabled.');
  if (c.multiThreading < 1) errors.push('Multi-threading must be at least 1.');
  try { if (c.crawlerUrl) new URL(c.crawlerUrl); } catch { errors.push('Crawler URL format is invalid.'); }
  res.json({ valid: errors.length === 0, errors });
});

app.get('/api/test-cases/static', (_req, res) => {
  const { data: rows } = parseCsvFile(STATIC_CSV);
  res.json(rows.map((r) => ({
    id: r.id,
    transactionName: r['Transaction Name'] ?? '',
    pageUrl: r['Path Page URL'] ?? '',
    elementIdentifier: r['Element Identifier'] ?? '',
    elementSelector: r['Element Selector'] ?? '',
  })));
});

app.put('/api/test-cases/static', (req, res) => {
  const cases = req.body;
  const header = 'Transaction Name,Path Page URL,Element Identifier,Element Selector\n';
  const body = cases.map((c) =>
    `${c.transactionName},${c.pageUrl},${c.elementIdentifier},${c.elementSelector}`
  ).join('\n');
  fs.writeFileSync(STATIC_CSV, header + body + (body ? '\n' : ''));
  try {
    saveScript({
      id: 'legacy_static',
      name: 'Legacy Static Test Cases',
      type: 'static',
      source: 'legacy',
      description: 'Synced from StaticTestCases.csv',
      rows: cases.map((c) => ({
        transactionName: c.transactionName,
        pageUrl: c.pageUrl,
        elementIdentifier: c.elementIdentifier,
        elementSelector: c.elementSelector,
      })),
    });
  } catch (err) {
    console.error('Failed to sync legacy static script:', err.message);
  }
  res.json({ ok: true });
});

app.get('/api/test-cases/scripted', (_req, res) => {
  const { data: rows } = parseCsvFile(SCRIPTED_CSV);
  res.json(rows.map((r) => ({
    id: r.id,
    testCaseName: r.Test_Case_Name ?? '',
    transactionName: r.Transaction_Name ?? '',
    testStep: r.Test_Steps ?? '',
    request: r.Request ?? '',
    selector: r.Selector ?? '',
    locator: r.Locator ?? '',
    action: r.Action ?? '',
    parameter: r.Parameter ?? '',
    elementToWait: r['Element to Wait'] ?? '',
    elementIdentifier: r['Element identifier'] ?? '',
    frameSelector: r.Frame_Selector ?? '',
  })));
});

app.put('/api/test-cases/scripted', (req, res) => {
  const steps = req.body;
  const header = 'Test_Case_Name,Transaction_Name,Test_Steps,Object_Name,Request,Selector,Locator,Action,Parameter,Element to Wait,Element identifier,Frame_Selector\n';
  const body = steps.map((s) =>
    `${s.testCaseName},${s.transactionName},${s.testStep},${s.objectName ?? ''},${s.request},${s.selector},${s.locator ?? 'Xpath'},${s.action},${s.parameter},${s.elementToWait ?? 'Xpath'},${s.elementIdentifier},${s.frameSelector ?? ''}`
  ).join('\n');
  fs.writeFileSync(SCRIPTED_CSV, header + body + (body ? '\n' : ''));
  try {
    saveScript({
      id: 'legacy_scripted',
      name: 'Legacy Scripted Flow',
      type: 'scripted',
      source: 'legacy',
      description: 'Synced from ScriptedTestCasesFilePath.csv',
      rows: steps.map((s) => ({
        testCaseName: s.testCaseName,
        transactionName: s.transactionName,
        testStep: s.testStep,
        objectName: s.objectName ?? '',
        request: s.request,
        selector: s.selector,
        locator: s.locator ?? 'Xpath',
        action: s.action,
        parameter: s.parameter,
        elementToWait: s.elementToWait ?? 'Xpath',
        elementIdentifier: s.elementIdentifier,
        frameSelector: s.frameSelector ?? '',
      })),
    });
  } catch (err) {
    console.error('Failed to sync legacy scripted script:', err.message);
  }
  res.json({ ok: true });
});

app.post('/api/crawl', (req, res) => {
  const { startUrl } = req.body;
  if (!startUrl) return res.status(400).json({ error: 'startUrl is required' });
  try { new URL(startUrl); } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  ensureDir(RESULTS_DIR);
  const crawlRunId = getNextRunId();
  crawlJobs.set(crawlRunId, {
    status: 'running',
    urls: [],
    urlsFound: 0,
    startUrl,
  });

  crawlWebsite(startUrl, crawlRunId).catch((err) => {
    const job = crawlJobs.get(crawlRunId);
    if (job) {
      job.status = 'failed';
      job.error = err.message;
    }
  });

  res.json({ crawlRunId, status: 'started' });
});

app.get('/api/crawl/:id/status', (req, res) => {
  const crawlRunId = req.params.id;
  const csvPath = crawledCsvPath(crawlRunId);
  const urlsFromDisk = fs.existsSync(csvPath) ? countUrlsInTestFile(csvPath) : 0;
  const job = crawlJobs.get(crawlRunId);
  if (!job) {
    if (urlsFromDisk > 0) {
      return res.json({ status: 'completed', urlsFound: urlsFromDisk, error: null });
    }
    return res.status(404).json({ error: 'Crawl job not found' });
  }
  res.json({
    status: job.status,
    urlsFound: Math.max(job.urlsFound ?? 0, urlsFromDisk),
    pagesVisited: job.pagesVisited ?? 0,
    error: job.error ?? null,
  });
});

app.post('/api/crawl/:id/cancel', (req, res) => {
  const job = crawlJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Crawl job not found' });
  job.status = 'cancelled';
  res.json({ ok: true });
});

app.get('/api/crawl/:id/urls', (req, res) => {
  res.json(loadCrawledUrlsFromCsv(req.params.id));
});

app.get('/api/crawl/:id/export.csv', (req, res) => {
  const csvPath = path.join(RESULTS_DIR, `crawled_urls_${req.params.id}.csv`);
  if (!fs.existsSync(csvPath)) return res.status(404).send('Not found');
  res.download(csvPath);
});

app.get('/api/runs', (_req, res) => {
  res.json(listRunsFromDisk());
});

app.get('/api/runs/:runId', (req, res) => {
  const runId = req.params.runId;
  const hasDir = fs.existsSync(path.join(RESULTS_DIR, `Static_RunID_${runId}`));
  const hasMeta = fs.existsSync(runMetaPath(runId));
  const hasActive = activeRuns.has(runId);
  if (!hasDir && !hasMeta && !hasActive) {
    return res.status(404).json({ error: 'Run not found' });
  }
  res.json(buildRunSummary(runId));
});

app.post('/api/runs', (req, res) => {
  const { mode = 'static', useAutoCrawl, testSuite, crawlRunId, config, scriptId } = req.body;

  if (config) writeConfigCsv(apiToConfig(config));

  const raw = readConfigCsv();
  raw.ScriptedFlow = mode === 'scripted' ? 'TRUE' : 'FALSE';
  raw.UserExperience = mode === 'static' ? 'TRUE' : (raw.UserExperience ?? 'FALSE');
  raw.AutoCrawl = useAutoCrawl ? 'TRUE' : 'FALSE';

  if (scriptId) {
    const script = getScript(scriptId);
    if (!script) return res.status(400).json({ error: 'Script not found' });
    if (script.type === 'static') {
      raw.ScriptedFlow = 'FALSE';
      raw.UserExperience = 'TRUE';
      raw.AutoCrawl = 'FALSE';
      updateProperties({ UserExperienceTestCaseFilePath: script.filePath, testCaseFiles: script.filePath });
    } else {
      raw.ScriptedFlow = 'TRUE';
      raw.UserExperience = 'FALSE';
      raw.AutoCrawl = 'FALSE';
      updateProperties({ ScriptedTestCasesFilePath: script.filePath });
    }
  } else if (testSuite === 'crawled' && crawlRunId) {
    raw.AutoCrawl = 'FALSE';
    const csvPath = path.join(RESULTS_DIR, `crawled_urls_${crawlRunId}.csv`);
    updateProperties({
      testCaseFiles: csvPath,
      UserExperienceTestCaseFilePath: csvPath,
    });
  } else if (testSuite === 'static') {
    raw.AutoCrawl = 'FALSE';
    updateProperties({
      UserExperienceTestCaseFilePath: STATIC_CSV,
    });
  } else if (mode === 'scripted') {
    raw.ScriptedFlow = 'TRUE';
    raw.UserExperience = 'FALSE';
    raw.AutoCrawl = 'FALSE';
    updateProperties({
      ScriptedTestCasesFilePath: SCRIPTED_CSV,
    });
  }

  writeConfigCsv(raw);
  syncRunPropertiesBeforeStart();

  const previewRunId = fs.existsSync(RUN_ID_FILE)
    ? String(parseInt(fs.readFileSync(RUN_ID_FILE, 'utf8').trim(), 10) + 1).padStart(4, '0')
    : '0001';

  const configSnapshot = configToApi(raw);
  const durationRaw = raw.Test_Duration_Seconds;
  const testDurationSeconds = durationRaw && durationRaw !== '0' && durationRaw !== 'NA'
    ? Number(durationRaw) : null;
  let urlsTotal = 0;
  let resolvedCrawlRunId = crawlRunId ?? null;
  if (scriptId) {
    const script = getScript(scriptId);
    urlsTotal = resolveUrlsTotal({ scriptId, mode });
    if (!resolvedCrawlRunId && script?.crawlRunId) {
      resolvedCrawlRunId = script.crawlRunId;
    }
  } else {
    urlsTotal = resolveUrlsTotal({ testSuite, crawlRunId, mode });
  }

  writeRunMeta(previewRunId, {
    runId: previewRunId,
    mode,
    status: 'running',
    startedAt: new Date().toISOString(),
    hostname: os.hostname(),
    configSnapshot,
    testDurationSeconds,
    multiThreading: Number(raw.Multi_Threading ?? 1),
    urlsTotal,
    scriptId: scriptId ?? null,
    crawlRunId: resolvedCrawlRunId,
  });

  try {
    spawnJavaRun(previewRunId, mode);
  } catch (err) {
    return res.status(500).json({ error: `Failed to start Java runner: ${err.message}. Ensure Maven and Java are installed.` });
  }

  res.json({
    id: `run-${previewRunId}`,
    runId: previewRunId,
    mode,
    status: useAutoCrawl ? 'crawling' : 'running',
    startedAt: new Date().toISOString(),
    hostname: os.hostname(),
    configSnapshot,
    testDurationSeconds,
    multiThreading: Number(raw.Multi_Threading ?? 1),
    urlsTotal,
    urlsCompleted: 0,
    passCount: 0,
    failCount: 0,
    crawlRunId: resolvedCrawlRunId ?? crawlRunId,
  });
});

app.post('/api/runs/:runId/stop', (req, res) => {
  const runId = req.params.runId;
  const meta = activeRuns.get(runId);
  const staticDir = path.join(RESULTS_DIR, `Static_RunID_${runId}`);
  const scriptedDir = path.join(RESULTS_DIR, `Scripted_RunID_${runId}`);
  ensureDir(staticDir);
  ensureDir(scriptedDir);
  const stopPayload = new Date().toISOString();
  fs.writeFileSync(path.join(staticDir, '.stop'), stopPayload);
  fs.writeFileSync(path.join(scriptedDir, '.stop'), stopPayload);

  const existing = readRunMeta(runId) ?? { runId };
  writeRunMeta(runId, {
    ...existing,
    status: 'stopped',
    endedAt: new Date().toISOString(),
  });

  if (meta?.child) {
    const child = meta.child;
    const forceKill = setTimeout(() => {
      if (activeRuns.has(runId)) {
        console.log(`[Run ${runId}] force-killing after graceful stop timeout`);
        child.kill('SIGKILL');
        activeRuns.delete(runId);
      }
    }, 120_000);
    child.on('close', () => {
      clearTimeout(forceKill);
      activeRuns.delete(runId);
      markRunCompleted(runId, 0);
    });
  }

  res.json({ ok: true });
});

app.delete('/api/runs/:runId', (req, res) => {
  const runId = req.params.runId;
  const active = activeRuns.get(runId);
  if (active?.child) {
    active.child.kill('SIGTERM');
    activeRuns.delete(runId);
  }
  const staticDir = path.join(RESULTS_DIR, `Static_RunID_${runId}`);
  if (fs.existsSync(staticDir)) {
    fs.rmSync(staticDir, { recursive: true, force: true });
  }
  const scriptedFiles = fs.readdirSync(RESULTS_DIR).filter((f) => f.includes(`ScriptedFlow_Test_${runId}`));
  for (const f of scriptedFiles) {
    fs.unlinkSync(path.join(RESULTS_DIR, f));
  }
  res.json({ ok: true });
});

app.get('/api/runs/:runId/results/static', (req, res) => {
  res.json(parseStaticResults(req.params.runId));
});

app.get('/api/runs/:runId/export.csv', (req, res) => {
  const p = path.join(RESULTS_DIR, `Static_RunID_${req.params.runId}`, `Static_Run_Report_RunID_${req.params.runId}.csv`);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'Report not ready yet' });
  res.download(p);
});

// ── Scripts library ───────────────────────────────────────────
app.get('/api/scripts', (req, res) => {
  res.json(listScripts(req.query.type));
});

app.get('/api/scripts/:id', (req, res) => {
  const script = getScript(req.params.id);
  if (!script) return res.status(404).json({ error: 'Script not found' });
  res.json(script);
});

app.post('/api/scripts', (req, res) => {
  const saved = saveScript(req.body);
  res.json(saved);
});

app.patch('/api/scripts/:id', (req, res) => {
  try {
    const { name } = req.body;
    const updated = renameScript(req.params.id, name);
    if (!updated) return res.status(404).json({ error: 'Script not found' });
    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/scripts/:id', (req, res) => {
  try {
    const { name } = req.body;
    const updated = renameScript(req.params.id, name);
    if (!updated) return res.status(404).json({ error: 'Script not found' });
    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/scripts/:id/rename', (req, res) => {
  try {
    const { name } = req.body;
    const updated = renameScript(req.params.id, name);
    if (!updated) return res.status(404).json({ error: 'Script not found' });
    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/scripts/sync-legacy', (_req, res) => {
  const synced = syncLegacyScripts({
    staticCsv: STATIC_CSV,
    scriptedCsv: SCRIPTED_CSV,
    resultsDir: RESULTS_DIR,
  });
  res.json({ synced: synced.length, scripts: synced });
});

app.post('/api/crawl/:id/save-script', (req, res) => {
  const crawlRunId = req.params.id;
  const { name } = req.body;
  const csvPath = path.join(RESULTS_DIR, `crawled_urls_${crawlRunId}.csv`);
  if (!fs.existsSync(csvPath)) {
    return res.status(404).json({ error: 'Crawl CSV not found' });
  }
  const script = importCrawledScript(crawlRunId, name, csvPath);
  res.json(script);
});

app.delete('/api/scripts/:id', (req, res) => {
  if (!deleteScript(req.params.id)) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// ── Recorder ──────────────────────────────────────────────────
app.post('/api/recorder/start', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });
    const result = await startRecorder(url);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/recorder/:sessionId/status', (req, res) => {
  const status = getRecorderStatus(req.params.sessionId);
  if (!status) return res.status(404).json({ error: 'Session not found' });
  res.json(status);
});

app.post('/api/recorder/:sessionId/stop', async (req, res) => {
  try {
    const result = await stopRecorder(req.params.sessionId, req.body.testCaseName);
    if (!result) return res.status(404).json({ error: 'Session not found' });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/recorder/:sessionId/cancel', async (req, res) => {
  await cancelRecorder(req.params.sessionId);
  res.json({ ok: true });
});

// ── Full run report with graphs & findings ────────────────────
app.get('/api/runs/:runId/report', (req, res) => {
  try {
    const report = generateRunReport(req.params.runId, RESULTS_DIR, parseStaticResults);
    if (!report.results?.length && !report.pages?.length) {
      const runDir = path.join(RESULTS_DIR, `Static_RunID_${req.params.runId}`);
      if (!fs.existsSync(runDir)) {
        return res.status(404).json({
          error: `No results found for run ${req.params.runId}. Run directory does not exist.`,
        });
      }
    }
    const htmlPath = path.join(RESULTS_DIR, `Static_RunID_${req.params.runId}`, `Consolidated_Report_RunID_${req.params.runId}.html`);
    if (fs.existsSync(htmlPath)) {
      report.meta = { ...report.meta, htmlReportPath: htmlPath };
    }
    res.json(report);
  } catch (err) {
    console.error('Report generation failed:', err);
    res.status(500).json({ error: err.message || 'Report generation failed' });
  }
});

app.get('/api/runs/:runId/report.html', (req, res) => {
  const htmlPath = path.join(RESULTS_DIR, `Static_RunID_${req.params.runId}`, `Consolidated_Report_RunID_${req.params.runId}.html`);
  if (!fs.existsSync(htmlPath)) {
    try {
      generateRunReport(req.params.runId, RESULTS_DIR, parseStaticResults);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
  if (!fs.existsSync(htmlPath)) {
    return res.status(404).json({ error: 'HTML report not generated. Ensure Python 3 is installed.' });
  }
  res.sendFile(htmlPath);
});

ensureDir(RESULTS_DIR);
try {
  const synced = syncLegacyScripts({
    staticCsv: STATIC_CSV,
    scriptedCsv: SCRIPTED_CSV,
    resultsDir: RESULTS_DIR,
  });
  console.log(`Synced ${synced.length} scripts (legacy static, scripted, crawled URLs)`);
} catch (err) {
  console.error('Script sync on startup failed:', err.message);
}
app.listen(PORT, () => {
  console.log(`UI Performance Bot API running at http://localhost:${PORT}`);
  console.log(`Workspace: ${WORKSPACE_ROOT}`);
});
