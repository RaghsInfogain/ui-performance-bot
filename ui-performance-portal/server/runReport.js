import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildRunReport } from './reportAnalysis.js';

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

export function generateRunReport(runId, resultsDir, parseStaticResults) {
  const pythonReport = runPythonAnalyzer(runId, resultsDir);

  if (pythonReport && !pythonReport.error) {
    return {
      runId,
      results: pythonReport.results ?? [],
      analysis: pythonReport.analysis ?? buildRunReport(pythonReport.results ?? []),
      pages: pythonReport.pages ?? [],
      llmAnalysis: pythonReport.llmAnalysis ?? null,
      meta: {
        ...(pythonReport.meta ?? {}),
        analyzer: 'python',
      },
    };
  }

  const results = parseStaticResults(runId);
  const runDir = path.join(resultsDir, `Static_RunID_${runId}`);
  const lhCount = fs.existsSync(runDir)
    ? fs.readdirSync(runDir).filter((f) => f.startsWith('Infogain_UEM_DataFile') && f.endsWith('.json')).length
    : 0;

  return {
    runId,
    results,
    analysis: buildRunReport(results),
    pages: [],
    meta: {
      analyzer: 'javascript-fallback',
      lighthouseJsonCount: lhCount,
      csvRowCount: results.length,
      pythonError: pythonReport?.error ?? 'Python analyzer unavailable — using CSV only. Install Python 3 and restart API.',
    },
  };
}
