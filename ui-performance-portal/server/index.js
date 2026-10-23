import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import * as cheerio from 'cheerio';
import { parseCsvFile as parseCsvFromDisk, parseCsvContent, parseUemResultRows, countUrlsInCsvFile, countRowsInCsvFile, toCsvRow } from './csvUtils.js';
import {
  STATIC_HEADERS, SCRIPTED_HEADERS, BODY_ANCHOR, pickAnchorFromCheerio, isAssetUrl,
  transactionNameFromUrl,
} from './scriptFormat.js';
import {
  listScripts, getScript, saveScript, deleteScript, renameScript, syncLegacyScripts, importCrawledScript,
  materializeScriptCsv, ensureScriptNumbers, ensureScriptDataTable, getScriptData, saveScriptData,
  setScriptDataMode, deleteScriptData, materializeScriptData, parseDataCsv,
} from './scriptsStore.js';
import { startRecorder, stopRecorder, cancelRecorder, getRecorderStatus, buildRecordingArtifacts, replaySteps, startReplay, getReplayStatus } from './recorder.js';
import {
  listRecordings, getRecording, saveRecording, updateRecording, deleteRecording,
  ensureRecordingsTable,
} from './recordingsStore.js';
import { buildRunReport } from './reportAnalysis.js';
import { generateRunReport } from './runReport.js';
import { buildComparisonReport } from './compareReports.js';
import {
  ensureReportTables, getCachedReport, saveCachedReport,
  listSchedules, saveSchedule, deleteSchedule,
} from './reportsStore.js';
import { startScheduleTicker } from './scheduler.js';
import { signup, login, logout, me } from './authStore.js';
import { readConfig, writeConfig, materializeConfigCsv, configToApi, apiToConfig } from './configStore.js';
import {
  upsertRun, getRun, listRuns as listRunsFromDb, updateRunStatus, deleteRun as deleteRunFromDb,
  upsertRunResults, getRunResults, upsertCrawl, replaceCrawlUrls, getCrawl, getCrawlUrls,
} from './runsStore.js';
import { migrateFromFilesystem } from './db/migrateFromFs.js';
import { getSetting, setSetting } from './db/pool.js';

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

/**
 * Bump when report generation changes in a way cached reports should pick up.
 * 2: Lighthouse results keyed by the tested (requested) URL, not the post-redirect URL.
 */
const REPORT_FORMAT_VERSION = 3; // 3: script / load-event split when DOMContentLoaded wasn't captured

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function getNextRunId() {
  let current = await getSetting('next_run_id');
  if (!current && fs.existsSync(RUN_ID_FILE)) {
    current = fs.readFileSync(RUN_ID_FILE, 'utf8').trim() || '0000';
  }
  if (!current) current = '0000';
  const next = String(parseInt(current, 10) + 1).padStart(4, '0');
  await setSetting('next_run_id', next);
  fs.writeFileSync(RUN_ID_FILE, next);
  return next;
}

async function readConfigCsv() {
  return readConfig();
}

async function writeConfigCsv(raw) {
  await writeConfig(raw);
  await materializeConfigCsv(CONFIG_CSV);
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

async function crawlWebsite(startUrl, crawlRunId) {
  const job = crawlJobs.get(crawlRunId);
  const startHost = new URL(startUrl).hostname;
  const visited = new Set();
  const discovered = new Set();
  const queued = new Set();
  const queue = [startUrl.split('#')[0]];
  const deadline = Date.now() + CRAWL_MAX_DURATION_MS;
  const csvPath = path.join(RESULTS_DIR, `crawled_urls_${crawlRunId}.csv`);
  /** @type {Map<string, { transactionName: string, pageUrl: string, identifier: string, selector: string }>} */
  const rows = new Map();
  const usedNames = new Map();
  job.pagesVisited = 0;

  // Trailing-slash variants are the same page
  const pageKey = (u) => u.replace(/\/+$/, '');

  const writeCsv = () => {
    const lines = [...rows.values()].map((r) => toCsvRow([r.transactionName, r.pageUrl, r.identifier, r.selector]));
    fs.writeFileSync(csvPath, `${STATIC_HEADERS.join(',')}\n${lines.join('\n')}${lines.length ? '\n' : ''}`);
  };

  const uniqueName = (base) => {
    const n = (usedNames.get(base) ?? 0) + 1;
    usedNames.set(base, n);
    return n === 1 ? base : `${base}_${n}`;
  };

  const appendRow = (pageUrl) => {
    const key = pageKey(pageUrl);
    if (discovered.has(key) || isAssetUrl(pageUrl)) return;
    discovered.add(key);
    // Until the page is visited we only know it exists; body is the safe load anchor
    rows.set(key, {
      transactionName: uniqueName(transactionNameFromUrl(pageUrl)),
      pageUrl,
      identifier: BODY_ANCHOR.identifier,
      selector: BODY_ANCHOR.selector,
    });
    job.urlsFound = discovered.size;
    writeCsv();
  };

  const setAnchor = (pageUrl, anchor) => {
    const row = rows.get(pageKey(pageUrl));
    if (!row) return;
    row.identifier = anchor.identifier;
    row.selector = anchor.selector;
    writeCsv();
  };

  appendRow(startUrl.split('#')[0]);

  try {
    while (queue.length > 0 && visited.size < MAX_CRAWL_PAGES && Date.now() < deadline) {
      if (job.status === 'cancelled') break;
      const url = queue.shift();
      if (!url || visited.has(url) || !sameHostname(url, startHost) || isAssetUrl(url)) continue;

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
        if (!String(res.headers.get('content-type') || 'text/html').includes('html')) continue;

        const buf = await res.arrayBuffer();
        if (buf.byteLength > MAX_HTML_BYTES) continue;

        const html = Buffer.from(buf).toString('utf8');
        const $ = cheerio.load(html);
        setAnchor(url, pickAnchorFromCheerio($));

        $('a[href]').each((_, el) => {
          const href = $(el).attr('href');
          if (!href) return;
          try {
            const abs = new URL(href, url).href.split('#')[0];
            if (!sameHostname(abs, startHost)) return;
            appendRow(abs);
            if (!visited.has(abs) && !queued.has(pageKey(abs)) && !isAssetUrl(abs)) {
              queued.add(pageKey(abs));
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
      await importCrawledScript(crawlRunId, `Crawled URLs (Run ${crawlRunId})`, csvPath);
      const urls = loadCrawledUrlsFromCsv(crawlRunId);
      await upsertCrawl({
        id: crawlRunId,
        startUrl: startUrl,
        status: job?.status === 'cancelled' ? 'cancelled' : 'completed',
        urlsFound: urls.length,
        startedAt: job?.startedAt,
        endedAt: new Date().toISOString(),
      });
      await replaceCrawlUrls(crawlRunId, urls);
    } catch (err) {
      console.error('Failed to save crawled URLs as script:', err.message);
    }
    console.log(`Crawl ${crawlRunId} done: ${discovered.size} URLs, ${visited.size} pages visited`);
  }
}

function runMetaPath(runId) {
  return path.join(RESULTS_DIR, `Static_RunID_${runId}`, 'run-meta.json');
}

async function readRunMeta(runId) {
  const fromDb = await getRun(runId);
  if (fromDb) return fromDb;
  const candidates = [
    runMetaPath(runId),
    path.join(RESULTS_DIR, `Scripted_RunID_${runId}`, 'run-meta.json'),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      /* next */
    }
  }
  return null;
}

async function writeRunMeta(runId, meta) {
  const staticDir = path.join(RESULTS_DIR, `Static_RunID_${runId}`);
  ensureDir(staticDir);
  if (meta?.mode === 'scripted') {
    ensureDir(path.join(RESULTS_DIR, `Scripted_RunID_${runId}`));
  }
  const payload = JSON.stringify({ ...meta, runId }, null, 2);
  fs.writeFileSync(runMetaPath(runId), payload);
  if (meta?.mode === 'scripted') {
    fs.writeFileSync(path.join(RESULTS_DIR, `Scripted_RunID_${runId}`, 'run-meta.json'), payload);
  }
  await upsertRun({ ...meta, runId });
}

async function markRunCompleted(runId, exitCode = 0) {
  const existing = (await readRunMeta(runId)) ?? { runId };
  const status = existing.status === 'stopped'
    ? 'stopped'
    : (exitCode === 0 ? 'completed' : 'failed');
  await writeRunMeta(runId, {
    ...existing,
    status,
    endedAt: existing.endedAt ?? new Date().toISOString(),
    exitCode,
  });
  try {
    const mode = existing.mode ?? (fs.existsSync(path.join(RESULTS_DIR, `Scripted_RunID_${runId}`)) ? 'scripted' : 'static');
    const results = mode === 'scripted' ? parseScriptedResults(runId) : parseStaticResults(runId);
    if (results.length) {
      upsertRunResults(runId, results).catch((err) => console.warn(`[Run ${runId}] result sync skipped:`, err.message));
    }
  } catch (err) {
    console.warn(`[Run ${runId}] result sync skipped:`, err.message);
  }
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

async function resolveUrlsTotal({ scriptId, testSuite, crawlRunId, mode }) {
  if (scriptId) {
    const script = await getScript(scriptId);
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

async function resolveUrlsTotalFromMeta(meta) {
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
  const results = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (!entry.pageUrl) continue;
      results.push({
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
  return results;
}

function uniqueUrlsCount(results) {
  return new Set(results.map((r) => r.pageUrl).filter(Boolean)).size;
}

function parseCsvResultsOnly(runId) {
  const reportPath = path.join(RESULTS_DIR, `Static_RunID_${runId}`, `Static_Run_Report_RunID_${runId}.csv`);
  if (!fs.existsSync(reportPath)) return [];
  const content = fs.readFileSync(reportPath, 'utf8');
  const rows = parseUemResultRows(content);
  // Keep every hit — UI aggregates by URL (avg when hits > 1)
  return rows.map((r) => mapUemRow(runId, r));
}

function parseStaticResults(runId) {
  const csvResults = parseCsvResultsOnly(runId);
  // Prefer full CSV once available; otherwise stream all progress hits
  const results = csvResults.length ? csvResults : parseProgressResults(runId);
  return results.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
}

function findScriptedResultCsv(runId) {
  const candidates = [
    path.join(RESULTS_DIR, `Scripted_RunID_${runId}`, `ScriptedFlow_Test_${runId}_Results.csv`),
    path.join(RESULTS_DIR, `Scripted_RunID_${runId}`, `Scripted_Flow_Run_ID${runId}`, `ScriptedFlow_Test_${runId}_Results.csv`),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  // Fallback: any matching CSV under the scripted run folder
  const dir = path.join(RESULTS_DIR, `Scripted_RunID_${runId}`);
  if (!fs.existsSync(dir)) return null;
  try {
    const walk = (d) => {
      for (const name of fs.readdirSync(d)) {
        const full = path.join(d, name);
        const st = fs.statSync(full);
        if (st.isDirectory()) {
          const found = walk(full);
          if (found) return found;
        } else if (name.includes(`ScriptedFlow_Test_${runId}`) && name.endsWith('.csv')) {
          return full;
        }
      }
      return null;
    };
    return walk(dir);
  } catch {
    return null;
  }
}

function parseScriptedProgress(runId) {
  const progressPath = path.join(RESULTS_DIR, `Scripted_RunID_${runId}`, 'run-progress.jsonl');
  if (!fs.existsSync(progressPath)) return [];
  const lines = fs.readFileSync(progressPath, 'utf8').split('\n').filter(Boolean);
  const results = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      results.push({
        runId,
        timestamp: entry.timestamp ?? '',
        hostname: os.hostname(),
        transaction: entry.transaction ?? '',
        testStepName: entry.pageUrl ?? '',
        request: entry.pageUrl ?? '',
        pageUrl: entry.pageUrl ?? '',
        waitingElement: '',
        waitingElementLoadTime: String(entry.pageLoadTime ?? ''),
        playwrightPageLoadTime: String(entry.pageLoadTime ?? ''),
        testStatus: entry.testStatus === 'FAIL' ? 'FAIL' : 'PASS',
        failureReason: entry.failureReason ?? '',
        pageLoadTime: String(entry.pageLoadTime ?? ''),
        fcp: '0',
        lcp: '0',
        performanceScore: String(entry.performanceScore ?? '0'),
      });
    } catch {
      /* skip */
    }
  }
  return results;
}

function parseScriptedResults(runId) {
  const csvPath = findScriptedResultCsv(runId);
  if (!csvPath) {
    return parseScriptedProgress(runId);
  }
  try {
    const content = fs.readFileSync(csvPath, 'utf8');
    const { data: rows } = parseCsvContent(content);
    const mapped = rows.map((r) => {
      const request = r.Request ?? '';
      const testStepName = r['Test Step Name'] ?? '';
      const transaction = r.Transaction ?? '';
      return {
        runId,
        timestamp: r.Timestamp ?? '',
        transaction,
        hostname: r.HostName ?? '',
        testStepName,
        request,
        pageUrl: request || testStepName || transaction,
        waitingElement: r['Waiting Element'] ?? '',
        waitingElementLoadTime: r['Waiting Element Load Time'] ?? '',
        playwrightPageLoadTime: r['Playwirght Page Load Time'] ?? r['Playwright Page Load Time'] ?? '',
        testStatus: String(r['Test Status'] ?? 'PASS').toUpperCase().includes('FAIL') ? 'FAIL' : 'PASS',
        failureReason: r['Failure Reason'] ?? '',
        pageLoadTime: r['Page Load Time'] ?? '',
        fcp: r['First Contentful Paint'] ?? '',
        lcp: r['Last Contentful Paint'] ?? '',
        performanceScore: r['Performance Score'] ?? '',
      };
    });
    return mapped.length ? mapped : parseScriptedProgress(runId);
  } catch (err) {
    console.warn(`[Run ${runId}] failed to parse scripted results:`, err.message);
    return parseScriptedProgress(runId);
  }
}

async function buildRunSummary(runId, mode = 'static') {
  const meta = await readRunMeta(runId);
  const resolvedMode = meta?.mode ?? mode;
  const staticResults = parseStaticResults(runId);
  const scriptedResults = resolvedMode === 'scripted' ? parseScriptedResults(runId) : [];
  const results = resolvedMode === 'scripted' ? scriptedResults : staticResults;
  const passCount = results.filter((r) => r.testStatus === 'PASS').length;
  const failCount = results.filter((r) => r.testStatus === 'FAIL').length;
  const scores = resolvedMode === 'scripted'
    ? scriptedResults.map((r) => Number(r.performanceScore)).filter((s) => s > 0)
    : staticResults.map((r) => r.performanceScore).filter((s) => s > 0);
  const uniquePages = resolvedMode === 'scripted'
    ? new Set(scriptedResults.map((r) => r.transaction || r.testStepName).filter(Boolean)).size
    : uniqueUrlsCount(staticResults);
  const urlsTotal = (await resolveUrlsTotalFromMeta(meta)) || meta?.urlsTotal || uniquePages || 0;
  const rawConfig = await readConfigCsv();

  return {
    id: `${resolvedMode}-${runId}`,
    runId,
    mode: resolvedMode,
    status: resolveRunStatus(runId, meta),
    startedAt: meta?.startedAt ?? results[0]?.timestamp ?? '',
    endedAt: meta?.endedAt ?? (results.length ? results[results.length - 1].timestamp : undefined),
    hostname: results[0]?.hostname ?? meta?.hostname ?? '',
    configSnapshot: meta?.configSnapshot ?? configToApi(rawConfig),
    testDurationSeconds: meta?.testDurationSeconds ?? null,
    multiThreading: meta?.multiThreading ?? 1,
    urlsTotal,
    urlsCompleted: uniquePages,
    passCount,
    failCount,
    hitCount: results.length,
    avgPerformanceScore: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : undefined,
    crawlRunId: meta?.crawlRunId ?? undefined,
    scriptId: meta?.scriptId ?? undefined,
  };
}

async function listRunsFromDisk() {
  ensureDir(RESULTS_DIR);
  const dbRuns = await listRunsFromDb();
  const seen = new Set();
  const runs = [];

  for (const meta of dbRuns) {
    seen.add(meta.runId);
    runs.push(await buildRunSummary(meta.runId, meta.mode ?? 'static'));
  }

  // Discover any disk-only runs not yet in DB
  if (fs.existsSync(RESULTS_DIR)) {
    for (const d of fs.readdirSync(RESULTS_DIR, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      let runId = null;
      let mode = 'static';
      if (d.name.startsWith('Static_RunID_')) {
        runId = d.name.replace('Static_RunID_', '');
        mode = 'static';
      } else if (d.name.startsWith('Scripted_RunID_')) {
        runId = d.name.replace('Scripted_RunID_', '');
        mode = 'scripted';
      }
      if (!runId || seen.has(runId)) continue;
      seen.add(runId);
      runs.push(await buildRunSummary(runId, mode));
    }
  }

  for (const [runId, meta] of activeRuns) {
    if (!seen.has(runId)) {
      const runMeta = await readRunMeta(runId);
      const rawConfig = await readConfigCsv();
      runs.unshift({
        id: `active-${runId}`,
        runId,
        mode: meta.mode,
        status: resolveRunStatus(runId, runMeta),
        startedAt: meta.startedAt,
        hostname: 'localhost',
        configSnapshot: runMeta?.configSnapshot ?? configToApi(rawConfig),
        testDurationSeconds: runMeta?.testDurationSeconds ?? null,
        multiThreading: runMeta?.multiThreading ?? 1,
        urlsTotal: runMeta?.urlsTotal ?? 0,
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

function resolveJavaHome() {
  const candidates = [
    process.env.JAVA_HOME,
    '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
    '/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home',
    '/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home',
    '/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
  ].filter(Boolean);
  for (const home of candidates) {
    const javaBin = path.join(home, 'bin', 'java');
    if (fs.existsSync(javaBin)) return home;
  }
  return process.env.JAVA_HOME || '';
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
  const javaHome = resolveJavaHome();
  const brewBin = fs.existsSync('/opt/homebrew/bin') ? '/opt/homebrew/bin' : '/usr/local/bin';
  const javaBin = javaHome ? path.join(javaHome, 'bin') : '';
  const pathParts = [javaBin, brewBin, portalBin, process.env.PATH || ''].filter(Boolean);
  return {
    ...process.env,
    ...(javaHome ? { JAVA_HOME: javaHome } : {}),
    LIGHTHOUSE_BIN: fs.existsSync(lighthouseBin) ? lighthouseBin : '',
    NPM_CONFIG_CACHE: npmCache,
    PATH: pathParts.join(path.delimiter),
  };
}

function resolveMvnBin() {
  const candidates = [
    process.platform === 'win32' ? 'mvn.cmd' : null,
    '/opt/homebrew/bin/mvn',
    '/usr/local/bin/mvn',
    'mvn',
  ].filter(Boolean);
  for (const bin of candidates) {
    if (bin === 'mvn' || bin === 'mvn.cmd') return bin;
    if (fs.existsSync(bin)) return bin;
  }
  return process.platform === 'win32' ? 'mvn.cmd' : 'mvn';
}

function spawnJavaRun(runId, mode, { propertiesFile, skipCompile = false } = {}) {
  const mvn = resolveMvnBin();
  const resultDir = path.join(RESULTS_DIR, `${mode === 'scripted' ? 'Scripted' : 'Static'}_RunID_${runId}`);
  ensureDir(resultDir);
  const logPath = path.join(resultDir, 'engine.log');
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  const env = {
    ...buildJavaRunEnv(),
    UIPB_RUN_ID: String(runId),
    ...(propertiesFile ? { UIPB_PROPERTIES_FILE: propertiesFile } : {}),
  };
  try {
    fs.writeFileSync(RUN_ID_FILE, String(runId));
  } catch {
    /* ignore */
  }
  const goals = skipCompile ? ['exec:java'] : ['test-compile', 'exec:java'];
  const child = spawn(mvn, ['-q', ...goals, '-Dexec.mainClass=PlaywrightUIPageload.Main'], {
    cwd: JAVA_PROJECT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (d) => {
    const text = d.toString();
    logStream.write(text);
    console.log(`[Run ${runId}]`, text);
  });
  child.stderr?.on('data', (d) => {
    const text = d.toString();
    logStream.write(text);
    console.error(`[Run ${runId}]`, text);
  });
  child.on('close', (code) => {
    logStream.write(`\n[engine] exited with code ${code}\n`);
    logStream.end();
    console.log(`[Run ${runId}] finished with code`, code);
    markRunCompleted(runId, code ?? 0).catch((err) => console.error(`[Run ${runId}] mark complete failed`, err));
    activeRuns.delete(runId);
  });
  child.on('error', (err) => {
    logStream.write(`\n[engine] spawn error: ${err.message}\n`);
    console.error(`[Run ${runId}] failed to spawn Maven:`, err.message);
  });

  activeRuns.set(runId, {
    pid: child.pid,
    child,
    startedAt: new Date().toISOString(),
    mode,
  });
}

/** Compile the Java engine once so concurrently launched runs don't race on target/. */
function compileJavaProject(logPaths = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveMvnBin(), ['-q', 'test-compile'], {
      cwd: JAVA_PROJECT,
      env: buildJavaRunEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout?.on('data', (d) => { output += d.toString(); });
    child.stderr?.on('data', (d) => { output += d.toString(); });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (output) {
        for (const p of logPaths) {
          try { fs.appendFileSync(p, `[compile]\n${output}\n`); } catch { /* ignore */ }
        }
      }
      if (code === 0) resolve();
      else reject(new Error(`Maven test-compile exited with code ${code}`));
    });
  });
}

/**
 * Split total threads across scripts by load %, using largest remainder so the
 * shares add up to the total. Every script gets at least one thread.
 */
function allocateThreads(totalThreads, percents) {
  const total = Math.max(1, Math.floor(totalThreads));
  const sum = percents.reduce((a, b) => a + b, 0) || 1;
  const exact = percents.map((p) => (total * p) / sum);
  const alloc = exact.map((x) => Math.floor(x));
  let remaining = total - alloc.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (remaining <= 0) break;
    alloc[i] += 1;
    remaining -= 1;
  }
  return alloc.map((n) => Math.max(1, n));
}

/** Engine properties for a script's test data; blank values clear data left by a previous run. */
function testDataProperties(data) {
  return {
    ScriptedTestDataFilePath: data?.filePath ?? '',
    ScriptedTestDataMode: data?.mode ?? '',
  };
}

function writePropertiesFile(filePath, map) {
  const out = Object.entries(map).map(([k, v]) => `${k}=${String(v).replace(/\\/g, '\\\\')}`).join('\n') + '\n';
  fs.writeFileSync(filePath, out);
}

// ── Routes ─────────────────────────────────────────────────────

// ── Routes ─────────────────────────────────────────────────────

app.get('/api/health', async (_req, res) => {
  let database = false;
  try {
    const { query } = await import('./db/pool.js');
    await query('SELECT 1');
    database = true;
  } catch {
    database = false;
  }
  res.json({
    ok: true,
    workspace: WORKSPACE_ROOT,
    javaProject: fs.existsSync(JAVA_PROJECT),
    config: fs.existsSync(CONFIG_CSV),
    database,
  });
});

app.post('/api/auth/signup', async (req, res) => {
  try {
    res.json(await signup(req.body ?? {}));
  } catch (err) {
    res.status(400).json({ error: err.message || 'Signup failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    res.json(await login(req.body ?? {}));
  } catch (err) {
    res.status(401).json({ error: err.message || 'Login failed' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  res.json(await logout(token));
});

app.get('/api/auth/me', async (req, res) => {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const user = await me(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json(user);
});

app.get('/api/config', async (_req, res) => {
  res.json(configToApi(await readConfigCsv()));
});

app.put('/api/config', async (req, res) => {
  await writeConfigCsv(apiToConfig(req.body));
  res.json(configToApi(await readConfigCsv()));
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

app.put('/api/test-cases/static', async (req, res) => {
  const cases = req.body;
  const header = `${STATIC_HEADERS.join(',')}\n`;
  const body = cases.map((c) => toCsvRow([c.transactionName, c.pageUrl, c.elementIdentifier, c.elementSelector])).join('\n');
  fs.writeFileSync(STATIC_CSV, header + body + (body ? '\n' : ''));
  try {
    await saveScript({
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

app.put('/api/test-cases/scripted', async (req, res) => {
  const steps = req.body;
  const header = `${SCRIPTED_HEADERS.join(',')}\n`;
  const body = steps.map((s) => toCsvRow([
    s.testCaseName, s.transactionName, s.testStep, s.objectName ?? '', s.request, s.selector,
    s.locator ?? 'Xpath', s.action, s.parameter, s.elementToWait ?? 'Xpath', s.elementIdentifier, s.frameSelector ?? '',
  ])).join('\n');
  fs.writeFileSync(SCRIPTED_CSV, header + body + (body ? '\n' : ''));
  try {
    await saveScript({
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

app.post('/api/crawl', async (req, res) => {
  const { startUrl } = req.body;
  if (!startUrl) return res.status(400).json({ error: 'startUrl is required' });
  try { new URL(startUrl); } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  ensureDir(RESULTS_DIR);
  const crawlRunId = await getNextRunId();
  const startedAt = new Date().toISOString();
  crawlJobs.set(crawlRunId, {
    status: 'running',
    urls: [],
    urlsFound: 0,
    startUrl,
    startedAt,
  });
  await upsertCrawl({ id: crawlRunId, startUrl, status: 'running', urlsFound: 0, startedAt });

  crawlWebsite(startUrl, crawlRunId).catch(async (err) => {
    const job = crawlJobs.get(crawlRunId);
    if (job) {
      job.status = 'failed';
      job.error = err.message;
    }
    await upsertCrawl({ id: crawlRunId, startUrl, status: 'failed', error: err.message, urlsFound: 0, startedAt, endedAt: new Date().toISOString() });
  });

  res.json({ crawlRunId, status: 'started' });
});

app.get('/api/crawl/:id/status', async (req, res) => {
  const crawlRunId = req.params.id;
  const csvPath = crawledCsvPath(crawlRunId);
  const urlsFromDisk = fs.existsSync(csvPath) ? countUrlsInTestFile(csvPath) : 0;
  const job = crawlJobs.get(crawlRunId);
  const dbCrawl = await getCrawl(crawlRunId);
  if (!job) {
    if (dbCrawl) {
      return res.json({ status: dbCrawl.status, urlsFound: Math.max(dbCrawl.urlsFound ?? 0, urlsFromDisk), error: dbCrawl.error ?? null });
    }
    if (urlsFromDisk > 0) {
      return res.json({ status: 'completed', urlsFound: urlsFromDisk, error: null });
    }
    return res.status(404).json({ error: 'Crawl job not found' });
  }
  res.json({
    status: job.status,
    urlsFound: Math.max(job.urlsFound ?? 0, urlsFromDisk, dbCrawl?.urlsFound ?? 0),
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

app.get('/api/crawl/:id/urls', async (req, res) => {
  const fromDb = await getCrawlUrls(req.params.id);
  if (fromDb.length) return res.json(fromDb);
  res.json(loadCrawledUrlsFromCsv(req.params.id));
});

app.get('/api/crawl/:id/export.csv', (req, res) => {
  const csvPath = path.join(RESULTS_DIR, `crawled_urls_${req.params.id}.csv`);
  if (!fs.existsSync(csvPath)) return res.status(404).send('Not found');
  res.download(csvPath);
});

app.get('/api/runs', async (_req, res) => {
  res.json(await listRunsFromDisk());
});

app.get('/api/runs/:runId', async (req, res) => {
  const runId = req.params.runId;
  const hasDir = fs.existsSync(path.join(RESULTS_DIR, `Static_RunID_${runId}`))
    || fs.existsSync(path.join(RESULTS_DIR, `Scripted_RunID_${runId}`));
  const hasMeta = fs.existsSync(runMetaPath(runId))
    || fs.existsSync(path.join(RESULTS_DIR, `Scripted_RunID_${runId}`, 'run-meta.json'))
    || Boolean(await getRun(runId));
  const hasActive = activeRuns.has(runId);
  if (!hasDir && !hasMeta && !hasActive) {
    return res.status(404).json({ error: 'Run not found' });
  }
  res.json(await buildRunSummary(runId));
});

app.post('/api/runs', async (req, res) => {
  try {
    let { mode = 'static', useAutoCrawl, testSuite, crawlRunId, config, scriptId } = req.body;

    if (config) await writeConfigCsv(apiToConfig(config));

    if (scriptId) {
      const scriptForMode = await getScript(scriptId);
      if (scriptForMode?.type === 'scripted') mode = 'scripted';
      else if (scriptForMode?.type === 'static') mode = 'static';
    }

    const raw = await readConfigCsv();
    raw.ScriptedFlow = mode === 'scripted' ? 'TRUE' : 'FALSE';
    raw.UserExperience = mode === 'scripted' ? 'FALSE' : 'TRUE';
    raw.AutoCrawl = useAutoCrawl ? 'TRUE' : 'FALSE';

    if (scriptId) {
      const script = await getScript(scriptId);
      if (!script) return res.status(400).json({ error: 'Script not found' });
      const filePath = await materializeScriptCsv(scriptId);
      if (script.type === 'static') {
        raw.ScriptedFlow = 'FALSE';
        raw.UserExperience = 'TRUE';
        raw.AutoCrawl = 'FALSE';
        updateProperties({ UserExperienceTestCaseFilePath: filePath, testCaseFiles: filePath });
      } else {
        raw.ScriptedFlow = 'TRUE';
        raw.UserExperience = 'FALSE';
        raw.AutoCrawl = 'FALSE';
        updateProperties({ ScriptedTestCasesFilePath: filePath, ...testDataProperties(await materializeScriptData(scriptId)) });
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
        ...testDataProperties(null),
      });
    }

    await writeConfigCsv(raw);
    syncRunPropertiesBeforeStart();

    const previewRunId = await getNextRunId();

    const configSnapshot = configToApi(raw);
    const durationRaw = raw.Test_Duration_Seconds;
    const testDurationSeconds = durationRaw && durationRaw !== '0' && durationRaw !== 'NA'
      ? Number(durationRaw) : null;
    let urlsTotal = 0;
    let resolvedCrawlRunId = crawlRunId ?? null;
    if (scriptId) {
      const script = await getScript(scriptId);
      urlsTotal = await resolveUrlsTotal({ scriptId, mode });
      if (!resolvedCrawlRunId && script?.crawlRunId) {
        resolvedCrawlRunId = script.crawlRunId;
      }
    } else {
      urlsTotal = await resolveUrlsTotal({ testSuite, crawlRunId, mode });
    }

    await writeRunMeta(previewRunId, {
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
  } catch (err) {
    console.error('POST /api/runs failed:', err);
    res.status(500).json({ error: err.message || 'Failed to start run' });
  }
});

/**
 * Launch one or more saved scripts together. Each script runs in its own engine
 * process with a private config.csv / Properties file, and receives a share of
 * the total threads defined by its load %.
 */
app.post('/api/runs/batch', async (req, res) => {
  try {
    const { scripts: requested, execution = {} } = req.body ?? {};
    if (!Array.isArray(requested) || !requested.length) {
      return res.status(400).json({ error: 'Select at least one script' });
    }
    const entries = [];
    for (const item of requested) {
      const script = await getScript(item.scriptId);
      if (!script) return res.status(400).json({ error: `Script not found: ${item.scriptId}` });
      entries.push({ script, loadPercent: Number(item.loadPercent) || 0 });
    }
    if (entries.length === 1) entries[0].loadPercent = 100;
    const percentSum = entries.reduce((a, e) => a + e.loadPercent, 0);
    if (entries.some((e) => e.loadPercent <= 0) || Math.round(percentSum) !== 100) {
      return res.status(400).json({ error: `Load % must be positive and add up to 100 (currently ${percentSum})` });
    }

    const totalThreads = Math.max(1, Math.floor(Number(execution.multiThreading) || 1));
    const threads = allocateThreads(totalThreads, entries.map((e) => e.loadPercent));
    const baseConfig = await readConfigCsv();
    const durationSeconds = Number(execution.testDurationSeconds) > 0 ? Math.floor(Number(execution.testDurationSeconds)) : 0;
    const batchId = `batch_${Date.now()}`;
    const startedAt = new Date().toISOString();
    const launches = [];

    for (let i = 0; i < entries.length; i++) {
      const { script, loadPercent } = entries[i];
      const mode = script.type === 'scripted' ? 'scripted' : 'static';
      const runId = await getNextRunId();
      const scriptCsv = await materializeScriptCsv(script.id);
      const runDir = path.join(RESULTS_DIR, `${mode === 'scripted' ? 'Scripted' : 'Static'}_RunID_${runId}`);
      ensureDir(runDir);

      const raw = {
        ...baseConfig,
        BrowserType: execution.browserType || baseConfig.BrowserType || 'chrome',
        Headless_Mode: execution.headlessMode === false ? 'FALSE' : 'TRUE',
        Test_Duration_Seconds: String(durationSeconds),
        Think_Time: String(Math.max(0, Number(execution.thinkTime) || 0)),
        Multi_Threading: String(threads[i]),
        ScriptedFlow: mode === 'scripted' ? 'TRUE' : 'FALSE',
        UserExperience: mode === 'scripted' ? 'FALSE' : 'TRUE',
        AutoCrawl: 'FALSE',
      };
      const configPath = path.join(runDir, 'run-config.csv');
      fs.writeFileSync(configPath, Object.entries(raw).map(([k, v]) => `${k},${v}`).join('\n') + '\n');

      const propertiesFile = path.join(runDir, 'run.properties');
      writePropertiesFile(propertiesFile, {
        configFilePath: configPath,
        ResultDirectory: RESULTS_DIR,
        ScreenshotDirectory: path.join(WORKSPACE_ROOT, 'screenshots'),
        ...(mode === 'scripted'
          ? { ScriptedTestCasesFilePath: scriptCsv, ...testDataProperties(await materializeScriptData(script.id)) }
          : { UserExperienceTestCaseFilePath: scriptCsv, testCaseFiles: scriptCsv }),
      });

      const meta = {
        runId,
        mode,
        status: 'queued',
        startedAt,
        hostname: os.hostname(),
        configSnapshot: configToApi(raw),
        testDurationSeconds: durationSeconds || null,
        multiThreading: threads[i],
        urlsTotal: await resolveUrlsTotal({ scriptId: script.id, mode }),
        scriptId: script.id,
        scriptName: script.name,
        crawlRunId: script.crawlRunId ?? null,
        batchId,
        loadPercent,
      };
      await writeRunMeta(runId, meta);
      launches.push({ meta, propertiesFile, logPath: path.join(runDir, 'engine.log') });
    }

    res.json({
      batchId,
      totalThreads: threads.reduce((a, b) => a + b, 0),
      runs: launches.map(({ meta }) => ({
        runId: meta.runId,
        mode: meta.mode,
        scriptId: meta.scriptId,
        scriptName: meta.scriptName,
        loadPercent: meta.loadPercent,
        multiThreading: meta.multiThreading,
        status: meta.status,
      })),
    });

    // Compile once, then start every engine without recompiling.
    try {
      await compileJavaProject(launches.map((l) => l.logPath));
    } catch (err) {
      console.error(`[Batch ${batchId}] compile failed:`, err.message);
      for (const { meta } of launches) {
        await writeRunMeta(meta.runId, { ...meta, status: 'failed', endedAt: new Date().toISOString() });
      }
      return;
    }
    for (const { meta, propertiesFile } of launches) {
      const current = await readRunMeta(meta.runId);
      if (current?.status === 'stopped') continue;
      try {
        await writeRunMeta(meta.runId, { ...meta, status: 'running', startedAt: new Date().toISOString() });
        spawnJavaRun(meta.runId, meta.mode, { propertiesFile, skipCompile: true });
      } catch (err) {
        console.error(`[Run ${meta.runId}] failed to start:`, err.message);
        await writeRunMeta(meta.runId, { ...meta, status: 'failed', endedAt: new Date().toISOString() });
      }
    }
  } catch (err) {
    console.error('POST /api/runs/batch failed:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Failed to start runs' });
  }
});

app.post('/api/runs/:runId/stop', async (req, res) => {
  const runId = req.params.runId;
  const meta = activeRuns.get(runId);
  const staticDir = path.join(RESULTS_DIR, `Static_RunID_${runId}`);
  const scriptedDir = path.join(RESULTS_DIR, `Scripted_RunID_${runId}`);
  ensureDir(staticDir);
  ensureDir(scriptedDir);
  const stopPayload = new Date().toISOString();
  fs.writeFileSync(path.join(staticDir, '.stop'), stopPayload);
  fs.writeFileSync(path.join(scriptedDir, '.stop'), stopPayload);

  const existing = (await readRunMeta(runId)) ?? { runId };
  await writeRunMeta(runId, {
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

app.delete('/api/runs/:runId', async (req, res) => {
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
  await deleteRunFromDb(runId);
  res.json({ ok: true });
});

app.get('/api/runs/:runId/results/static', async (req, res) => {
  const fromDisk = parseStaticResults(req.params.runId);
  if (fromDisk.length) {
    // Background sync only — response must stay fast for multi-hit runs
    upsertRunResults(req.params.runId, fromDisk).catch(() => {});
    return res.json(fromDisk);
  }
  res.json(await getRunResults(req.params.runId));
});

app.get('/api/runs/:runId/results/scripted', (req, res) => {
  res.json(parseScriptedResults(req.params.runId));
});

app.get('/api/runs/:runId/export.csv', (req, res) => {
  const scripted = findScriptedResultCsv(req.params.runId);
  if (scripted) return res.download(scripted);
  const p = path.join(RESULTS_DIR, `Static_RunID_${req.params.runId}`, `Static_Run_Report_RunID_${req.params.runId}.csv`);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'Report not ready yet' });
  res.download(p);
});

// ── Scripts library (PostgreSQL) ──────────────────────────────
app.get('/api/scripts', async (req, res) => {
  res.json(await listScripts(req.query.type));
});

app.get('/api/scripts/:id', async (req, res) => {
  const script = await getScript(req.params.id);
  if (!script) return res.status(404).json({ error: 'Script not found' });
  res.json(script);
});

app.post('/api/scripts', async (req, res) => {
  const saved = await saveScript(req.body);
  res.json(saved);
});

app.patch('/api/scripts/:id', async (req, res) => {
  try {
    const { name } = req.body;
    const updated = await renameScript(req.params.id, name);
    if (!updated) return res.status(404).json({ error: 'Script not found' });
    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/scripts/:id', async (req, res) => {
  try {
    const { name } = req.body;
    const updated = await renameScript(req.params.id, name);
    if (!updated) return res.status(404).json({ error: 'Script not found' });
    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/scripts/:id/rename', async (req, res) => {
  try {
    const { name } = req.body;
    const updated = await renameScript(req.params.id, name);
    if (!updated) return res.status(404).json({ error: 'Script not found' });
    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/scripts/sync-legacy', async (_req, res) => {
  const synced = await syncLegacyScripts({
    staticCsv: STATIC_CSV,
    scriptedCsv: SCRIPTED_CSV,
    resultsDir: RESULTS_DIR,
  });
  res.json({ synced: synced.length, scripts: synced });
});

app.post('/api/crawl/:id/save-script', async (req, res) => {
  const crawlRunId = req.params.id;
  const { name } = req.body;
  const csvPath = path.join(RESULTS_DIR, `crawled_urls_${crawlRunId}.csv`);
  if (!fs.existsSync(csvPath)) {
    return res.status(404).json({ error: 'Crawl CSV not found' });
  }
  const script = await importCrawledScript(crawlRunId, name, csvPath);
  res.json(script);
});

// ── Script test data (CSV) — values substituted into ${column} placeholders at run time ──
app.get('/api/scripts/:id/data', async (req, res) => {
  res.json(await getScriptData(req.params.id));
});

// Body is the raw CSV text (not JSON) so large data files aren't limited by the JSON parser
app.put('/api/scripts/:id/data', express.text({ type: () => true, limit: '20mb' }), async (req, res) => {
  try {
    const script = await getScript(req.params.id);
    if (!script) return res.status(404).json({ error: 'Script not found' });
    if (script.type !== 'scripted') return res.status(400).json({ error: 'Test data is only for scripted flows' });
    const mode = String(req.query.mode || '');
    const csv = typeof req.body === 'string' ? req.body : '';
    if (!csv.trim()) {
      if (!mode) return res.status(400).json({ error: 'Upload a CSV file' });
      return res.json(await setScriptDataMode(req.params.id, mode));
    }
    const { headers, rows } = parseDataCsv(csv);
    const existing = await getScriptData(req.params.id);
    res.json(await saveScriptData(req.params.id, {
      headers,
      rows,
      mode: mode || existing?.mode || 'sequential',
      fileName: String(req.query.fileName || 'data.csv'),
    }));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/scripts/:id/data', async (req, res) => {
  await deleteScriptData(req.params.id);
  res.json({ ok: true });
});

app.get('/api/scripts/:id/data.csv', async (req, res) => {
  const out = await materializeScriptData(req.params.id);
  if (!out) return res.status(404).json({ error: 'No test data for this script' });
  const data = await getScriptData(req.params.id);
  res.download(out.filePath, data?.fileName || `${req.params.id}_data.csv`);
});

app.delete('/api/scripts/:id', async (req, res) => {
  if (!(await deleteScript(req.params.id))) return res.status(404).json({ error: 'Not found' });
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

/** Start live replay — returns replayId; poll GET /api/recorder/replay/:id for pass/fail as steps finish. */
app.post('/api/recorder/replay', async (req, res) => {
  try {
    const { startUrl, steps, headless, stepTimeout, name, sync } = req.body || {};
    if (!Array.isArray(steps) || !steps.length) {
      return res.status(400).json({ error: 'steps array required' });
    }
    if (sync) {
      const result = await replaySteps({
        startUrl: startUrl || '',
        steps,
        headless: !!headless,
        stepTimeout: Number(stepTimeout) || 30000,
        name: name || 'Replay',
      });
      return res.json(result);
    }
    const started = startReplay({
      startUrl: startUrl || '',
      steps,
      headless: !!headless,
      stepTimeout: Number(stepTimeout) || 30000,
      name: name || 'Replay',
    });
    res.json(started);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/recorder/replay/:replayId', (req, res) => {
  const status = getReplayStatus(req.params.replayId);
  if (!status) return res.status(404).json({ error: 'Replay not found' });
  res.json(status);
});

app.get('/api/recorder/replay/:replayId/report.csv', (req, res) => {
  const status = getReplayStatus(req.params.replayId);
  if (!status?.reportCsv || !fs.existsSync(status.reportCsv)) {
    return res.status(404).json({ error: 'Replay report not ready' });
  }
  res.download(status.reportCsv);
});

// ── Saved recordings (persisted captures) ─────────────────────
app.get('/api/recordings', async (_req, res) => {
  try {
    res.json(await listRecordings());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/recordings/:id', async (req, res) => {
  try {
    const rec = await getRecording(req.params.id);
    if (!rec) return res.status(404).json({ error: 'Recording not found' });
    const artifacts = buildRecordingArtifacts(rec.steps, rec.name, rec.startUrl);
    res.json({ ...rec, scripted: artifacts.scripted, static: artifacts.static });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/recordings/:id', async (req, res) => {
  try {
    const { name, steps, startUrl } = req.body;
    const artifacts = steps
      ? buildRecordingArtifacts(steps, name, startUrl)
      : null;
    const updated = await updateRecording(req.params.id, {
      name,
      steps: steps ?? undefined,
      startUrl,
      urlCount: artifacts?.urlCount,
    });
    if (!updated) return res.status(404).json({ error: 'Recording not found' });
    const rebuilt = buildRecordingArtifacts(updated.steps, updated.name, updated.startUrl);
    res.json({ ...updated, scripted: rebuilt.scripted, static: rebuilt.static });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/recordings/:id', async (req, res) => {
  try {
    if (!(await deleteRecording(req.params.id))) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/recordings/:id/generate-script', async (req, res) => {
  try {
    const rec = await getRecording(req.params.id);
    if (!rec) return res.status(404).json({ error: 'Recording not found' });
    const type = req.body?.type === 'static' ? 'static' : 'scripted';
    const name = (req.body?.name || rec.name || 'Recorded_Flow').trim();
    const artifacts = buildRecordingArtifacts(rec.steps, name, rec.startUrl);
    const rows = type === 'static' ? artifacts.static : artifacts.scripted;
    if (!rows.length) {
      return res.status(400).json({ error: type === 'static' ? 'No URLs in this recording' : 'No steps in this recording' });
    }
    const saved = await saveScript({
      name,
      type,
      description: `Generated from recording ${rec.id} (${rec.startUrl || 'no start URL'})`,
      rows,
      source: 'studio',
    });
    res.json(saved);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Replay a saved recording (or override steps from the editor). */
/** Replay a saved recording — live report; poll GET /api/recorder/replay/:replayId */
app.post('/api/recordings/:id/replay', async (req, res) => {
  try {
    const rec = await getRecording(req.params.id);
    if (!rec) return res.status(404).json({ error: 'Recording not found' });
    const steps = Array.isArray(req.body?.steps) && req.body.steps.length
      ? req.body.steps
      : (rec.steps || []);
    if (!steps.length) return res.status(400).json({ error: 'No steps to replay' });
    if (req.body?.sync) {
      const result = await replaySteps({
        startUrl: req.body?.startUrl || rec.startUrl || '',
        steps,
        headless: !!req.body?.headless,
        stepTimeout: Number(req.body?.stepTimeout) || 30000,
        name: rec.name || 'Replay',
      });
      return res.json(result);
    }
    const started = startReplay({
      startUrl: req.body?.startUrl || rec.startUrl || '',
      steps,
      headless: !!req.body?.headless,
      stepTimeout: Number(req.body?.stepTimeout) || 30000,
      name: rec.name || 'Replay',
    });
    res.json(started);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Manual save of an in-memory stop result (if auto-persist failed)
app.post('/api/recordings', async (req, res) => {
  try {
    const { name, startUrl, steps } = req.body;
    if (!Array.isArray(steps) || !steps.length) {
      return res.status(400).json({ error: 'steps array required' });
    }
    const artifacts = buildRecordingArtifacts(steps, name, startUrl);
    const saved = await saveRecording({
      name: name || 'Recorded_Flow',
      startUrl: startUrl || '',
      steps: artifacts.scripted,
      urlCount: artifacts.urlCount,
    });
    res.json({ ...saved, scripted: artifacts.scripted, static: artifacts.static });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Full run report with graphs & findings ────────────────────
app.get('/api/runs/:runId/report', async (req, res) => {
  try {
    const regenerate = req.query.regenerate === '1' || req.query.regenerate === 'true';
    if (!regenerate) {
      const cached = await getCachedReport(req.params.runId);
      // Reports saved by an older analyzer are rebuilt so fixes reach existing runs
      const current = cached?.meta?.formatVersion === REPORT_FORMAT_VERSION;
      if (cached && current && ((cached.results?.length || 0) > 0 || (cached.pages?.length || 0) > 0)) {
        return res.json(cached);
      }
    }

    const report = generateRunReport(req.params.runId, RESULTS_DIR, parseStaticResults);
    report.meta = { ...report.meta, formatVersion: REPORT_FORMAT_VERSION };
    if (!report.results?.length && !report.pages?.length) {
      const staticDir = path.join(RESULTS_DIR, `Static_RunID_${req.params.runId}`);
      const scriptedDir = path.join(RESULTS_DIR, `Scripted_RunID_${req.params.runId}`);
      if (!fs.existsSync(staticDir) && !fs.existsSync(scriptedDir) && !activeRuns.has(req.params.runId)) {
        return res.status(404).json({
          error: `No results found for run ${req.params.runId}. Run directory does not exist.`,
        });
      }
    }
    const htmlPath = path.join(RESULTS_DIR, `Static_RunID_${req.params.runId}`, `Consolidated_Report_RunID_${req.params.runId}.html`);
    if (fs.existsSync(htmlPath)) {
      report.meta = { ...report.meta, htmlReportPath: htmlPath };
    }
    try {
      if ((report.results?.length || 0) > 0 || (report.pages?.length || 0) > 0) {
        await saveCachedReport(req.params.runId, report, regenerate ? 'regenerate' : 'auto');
        report.meta = { ...report.meta, cached: true, generatedAt: new Date().toISOString() };
      }
    } catch (cacheErr) {
      console.error('Failed to cache report:', cacheErr.message);
    }
    res.json(report);
  } catch (err) {
    console.error('Report generation failed:', err);
    res.status(500).json({ error: err.message || 'Report generation failed' });
  }
});

app.post('/api/runs/:runId/report/regenerate', async (req, res) => {
  try {
    const report = generateRunReport(req.params.runId, RESULTS_DIR, parseStaticResults);
    report.meta = { ...report.meta, formatVersion: REPORT_FORMAT_VERSION };
    const htmlPath = path.join(RESULTS_DIR, `Static_RunID_${req.params.runId}`, `Consolidated_Report_RunID_${req.params.runId}.html`);
    if (fs.existsSync(htmlPath)) {
      report.meta = { ...report.meta, htmlReportPath: htmlPath };
    }
    await saveCachedReport(req.params.runId, report, 'regenerate');
    report.meta = { ...report.meta, cached: true, generatedAt: new Date().toISOString(), generator: 'regenerate' };
    res.json(report);
  } catch (err) {
    console.error('Report regenerate failed:', err);
    res.status(500).json({ error: err.message || 'Report regenerate failed' });
  }
});

app.get('/api/compare-runs', async (req, res) => {
  try {
    const baseline = String(req.query.baseline || '');
    const current = String(req.query.current || '');
    if (!baseline || !current) {
      return res.status(400).json({ error: 'baseline and current run IDs are required' });
    }
    if (baseline === current) {
      return res.status(400).json({ error: 'Select two different runs to compare' });
    }

    const loadReport = async (runId) => {
      let report = await getCachedReport(runId);
      if (!report?.results?.length && !report?.pages?.length) {
        report = generateRunReport(runId, RESULTS_DIR, parseStaticResults);
        if (report) {
          try { await saveCachedReport(runId, report, 'auto'); } catch { /* ignore */ }
        }
      }
      return report;
    };

    const [baseReport, currentReport] = await Promise.all([loadReport(baseline), loadReport(current)]);
    if (!baseReport && !currentReport) {
      return res.status(404).json({ error: 'Neither run has report data' });
    }
    const comparison = buildComparisonReport(baseline, current, baseReport || {}, currentReport || {});
    res.json(comparison);
  } catch (err) {
    console.error('Compare failed:', err);
    res.status(500).json({ error: err.message || 'Compare failed' });
  }
});

// ── Schedules ─────────────────────────────────────────────────
app.get('/api/schedules', async (_req, res) => {
  try {
    res.json(await listSchedules());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/schedules', async (req, res) => {
  try {
    const saved = await saveSchedule(req.body || {});
    res.json(saved);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/schedules/:id', async (req, res) => {
  try {
    const saved = await saveSchedule({ ...req.body, id: req.params.id });
    res.json(saved);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/schedules/:id', async (req, res) => {
  try {
    if (!(await deleteSchedule(req.params.id))) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
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

// Production (Docker): serve the built portal; React Router handles page URLs.
// In development Vite serves the portal and proxies /api here, and dist/ doesn't exist.
const DIST_DIR = path.join(__dirname, '../dist');
if (process.env.NODE_ENV === 'production' && fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')));
}

ensureDir(RESULTS_DIR);

async function startServer() {
  try {
    await migrateFromFilesystem();
    await ensureScriptNumbers();
    await ensureScriptDataTable();
    await ensureRecordingsTable();
    await ensureReportTables();
    console.log('PostgreSQL ready (DATABASE_URL or postgresql://localhost:5432/uiperformancebot)');
  } catch (err) {
    console.error('PostgreSQL migration/init failed:', err);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`UI Performance Bot API running at http://localhost:${PORT}`);
    console.log(`Workspace: ${WORKSPACE_ROOT}`);
    console.log('Persistence: PostgreSQL (portal state) + Results/ (Java/Lighthouse artifacts)');
    startScheduleTicker({ port: PORT });
  });
}

startServer();
