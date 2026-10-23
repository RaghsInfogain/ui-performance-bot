import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildRunReport } from './reportAnalysis.js';
import { parseCsvContent } from './csvUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_SCRIPT = path.join(__dirname, 'analyze_run_report.py');

function runPythonAnalyzer(runId, resultsDir) {
  const candidates = ['python3', 'python'];
  for (const bin of candidates) {
    const result = spawnSync(bin, [PYTHON_SCRIPT, runId, '--results-dir', resultsDir, '--write-html'], {
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 50 * 1024 * 1024,
    });
    if (result.error?.code === 'ENOENT') continue;
    if (result.status === 0 && result.stdout?.trim()) {
      try {
        return JSON.parse(result.stdout);
      } catch {
        console.error(`[Report ${runId}] Invalid JSON from Python analyzer`);
      }
    } else if (result.stderr) {
      console.error(`[Report ${runId}] Python stderr:`, result.stderr.slice(0, 500));
    }
    break;
  }
  return null;
}

function pythonHasPages(report) {
  if (!report || report.error) return false;
  return Boolean((report.results?.length) || (report.pages?.length));
}

function loadScriptedCsvRows(runId, resultsDir) {
  const candidates = [
    path.join(resultsDir, `Scripted_RunID_${runId}`, `ScriptedFlow_Test_${runId}_Results.csv`),
    path.join(resultsDir, `Scripted_RunID_${runId}`, `Scripted_Flow_Run_ID${runId}`, `ScriptedFlow_Test_${runId}_Results.csv`),
  ];
  let csvPath = candidates.find((p) => fs.existsSync(p));
  if (!csvPath) {
    const dir = path.join(resultsDir, `Scripted_RunID_${runId}`);
    if (fs.existsSync(dir)) {
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
      csvPath = walk(dir);
    }
  }
  if (!csvPath) return [];
  try {
    const { data: rows } = parseCsvContent(fs.readFileSync(csvPath, 'utf8'));
    return rows.map((r) => {
      const load = Number(r['Page Load Time'] || r['Waiting Element Load Time'] || 0) || 0;
      return {
        runId,
        timestamp: r.Timestamp ?? '',
        hostname: r.HostName ?? '',
        transaction: r.Transaction ?? '',
        pageUrl: r.Request || r['Test Step Name'] || r.Transaction || '',
        fcp: Number(r['First Contentful Paint'] ?? 0) || 0,
        lcp: Number(r['Last Contentful Paint'] ?? 0) || 0,
        tbt: Number(r['Total Blocking Time'] ?? 0) || 0,
        cls: Number(r['Cumulative Layout Shift'] ?? 0) || 0,
        speedIndex: Number(r['Speed Index'] ?? 0) || 0,
        performanceScore: Number(r['Performance Score'] ?? 0) || 0,
        pageLoadTime: load,
        networkTime: Number(r['Network Time'] ?? 0) || 0,
        dnsLookupTime: Number(r['DNS Lookup Time'] ?? 0) || 0,
        connectionTime: Number(r['Connection Time'] ?? 0) || 0,
        serverProcessingTime: Number(r['Server Processing Time'] ?? 0) || 0,
        responseTime: Number(r['Response Time'] ?? 0) || 0,
        browserTime: Number(r['Browser Time'] ?? 0) || 0,
        domInteractionTime: Number(r['DOM Interaction Time'] ?? 0) || 0,
        domCompleteTime: Number(r['DOM Complete Time'] ?? 0) || 0,
        playwrightPageLoadTime: Number(r['Playwirght Page Load Time'] || r['Playwright Page Load Time'] || 0) || 0,
        elementLoadTime: r['Waiting Element Load Time'] ?? 'N/A',
        testStatus: String(r['Test Status'] ?? 'PASS').toUpperCase().includes('FAIL') ? 'FAIL' : 'PASS',
        failureReason: r['Failure Reason'] ?? '',
        testStepName: r['Test Step Name'] ?? '',
        request: r.Request ?? '',
      };
    });
  } catch (err) {
    console.warn(`[Report ${runId}] failed to parse scripted CSV:`, err.message);
    return [];
  }
}

export function generateRunReport(runId, resultsDir, parseStaticResults) {
  const staticCsv = path.join(resultsDir, `Static_RunID_${runId}`, `Static_Run_Report_RunID_${runId}.csv`);
  const hasStaticCsv = fs.existsSync(staticCsv);
  const pythonReport = hasStaticCsv ? runPythonAnalyzer(runId, resultsDir) : null;

  if (pythonHasPages(pythonReport)) {
    return {
      runId,
      results: pythonReport.results ?? [],
      analysis: pythonReport.analysis ?? buildRunReport(pythonReport.results ?? []),
      pages: pythonReport.pages ?? [],
      llmAnalysis: pythonReport.llmAnalysis ?? null,
      meta: {
        ...(pythonReport.meta ?? {}),
        analyzer: 'python',
        mode: 'static',
      },
    };
  }

  const staticResults = typeof parseStaticResults === 'function' ? parseStaticResults(runId) : [];
  if (staticResults.length) {
    const runDir = path.join(resultsDir, `Static_RunID_${runId}`);
    const lhCount = fs.existsSync(runDir)
      ? fs.readdirSync(runDir).filter((f) => f.startsWith('Infogain_UEM_DataFile') && f.endsWith('.json')).length
      : 0;
    return {
      runId,
      results: staticResults,
      analysis: buildRunReport(staticResults),
      pages: [],
      meta: {
        analyzer: 'javascript-fallback',
        mode: 'static',
        lighthouseJsonCount: lhCount,
        csvRowCount: staticResults.length,
        pythonError: pythonReport?.error ?? 'Python analyzer unavailable — using CSV only.',
      },
    };
  }

  const scriptedResults = loadScriptedCsvRows(runId, resultsDir);
  return {
    runId,
    results: scriptedResults,
    analysis: buildRunReport(scriptedResults),
    pages: [],
    meta: {
      analyzer: 'scripted-csv',
      mode: scriptedResults.length ? 'scripted' : 'unknown',
      csvRowCount: scriptedResults.length,
      pythonError: pythonReport?.error || (!scriptedResults.length ? 'No static or scripted result rows found' : undefined),
    },
  };
}
