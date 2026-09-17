import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Download, BarChart3, RefreshCw, Trash2, Square } from 'lucide-react';
import { PageHeader } from '../components/layout/AppLayout';
import { DataTable } from '../components/common/DataTable';
import { StatusBadge, PassFailBadge, ScoreBadge } from '../components/common/Badges';
import { api } from '../services/api';
import { formatDuration } from '../utils/formatDuration';
import { clsStatus, fcpStatus, lcpStatus, siStatus, tbtStatus, vitalBadge } from '../utils/reportDesign';
import type { TestRun, StaticResultRow, ScriptedResultRow } from '../types';
import '../styles/runReport.css';

function MetricCell({ value, status, suffix = 'ms' }: { value: number; status: 'good' | 'warn' | 'poor'; suffix?: string }) {
  const display = suffix === '' ? value.toFixed(3) : `${Math.round(value)}${suffix}`;
  return <span className={`font-mono ${vitalBadge(status)}`}>{display}</span>;
}

export default function RunDetail() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const [run, setRun] = useState<TestRun | undefined>();
  const [staticResults, setStaticResults] = useState<StaticResultRow[]>([]);
  const [scriptedResults, setScriptedResults] = useState<ScriptedResultRow[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [now, setNow] = useState(Date.now());

  const [error, setError] = useState('');

  const load = async () => {
    if (!runId) return;
    try {
      const [r, staticR, scriptedR] = await Promise.all([
        api.getRun(runId),
        api.getStaticResults(runId),
        api.getScriptedResults(runId),
      ]);
      if (!r) {
        setError(`Run ${runId} not found`);
        setRun(undefined);
        return;
      }
      setError('');
      setRun(r);
      setStaticResults(staticR);
      setScriptedResults(scriptedR);
      if (r.startedAt) {
        setElapsedMs(Date.now() - new Date(r.startedAt).getTime());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load run');
      setRun(undefined);
    }
  };

  useEffect(() => {
    load();
  }, [runId]);

  useEffect(() => {
    if (!run || (run.status !== 'running' && run.status !== 'crawling')) return;
    const poll = setInterval(load, 3000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [run?.status, runId]);

  const handleExport = async () => {
    if (!run) return;
    try {
      const blob = await api.exportRunCsv(run.runId, run.mode);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `Static_Run_Report_RunID_${run.runId}.csv`;
      a.click();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Export failed');
    }
  };

  const handleStop = async () => {
    if (!runId) return;
    await api.stopRun(runId);
    load();
  };

  const handleDelete = async () => {
    if (!runId || !confirm(`Delete run ${runId} and all its result files?`)) return;
    await api.deleteRun(runId);
    navigate('/app/runs');
  };

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 p-6 text-red-800">
        <p className="font-semibold">{error}</p>
        <Link to="/app/runs" className="mt-3 inline-block text-sm text-brand-600 underline">Back to Run History</Link>
      </div>
    );
  }

  if (!run) return <div className="text-slate-400">Loading run {runId}…</div>;

  const isLive = run.status === 'running' || run.status === 'crawling';
  const durationSec = run.testDurationSeconds ?? run.configSnapshot?.testDurationSeconds ?? null;
  const durationMs = durationSec ? durationSec * 1000 : null;
  const startedMs = run.startedAt ? new Date(run.startedAt).getTime() : 0;
  const endedMs = run.endedAt ? new Date(run.endedAt).getTime() : null;
  const displayElapsed = startedMs
    ? (endedMs != null ? endedMs - startedMs : (isLive ? now - startedMs : elapsedMs))
    : 0;
  const timeProgress = durationMs ? Math.min(100, (displayElapsed / durationMs) * 100) : null;
  const urlProgress = run.urlsTotal > 0
    ? Math.min(100, (staticResults.length / run.urlsTotal) * 100)
    : null;
  const scoresWithValues = staticResults.filter((r) => r.performanceScore > 0);
  const avgScore = scoresWithValues.length
    ? scoresWithValues.reduce((s, r) => s + r.performanceScore, 0) / scoresWithValues.length
    : null;

  return (
    <>
      <PageHeader
        title={`Run ${run.runId}`}
        subtitle={`${run.mode} mode · ${isLive ? 'Live — refreshing every 3s' : 'Completed'}${run.multiThreading ? ` · ${run.multiThreading} threads` : ''}`}
        actions={
          <>
            <button onClick={load} className="btn-secondary"><RefreshCw className="h-4 w-4" /> Refresh</button>
            {isLive && (
              <button onClick={handleStop} className="btn-danger"><Square className="h-4 w-4" /> Stop</button>
            )}
            <Link to={`/app/runs/${run.runId}/report`} className="btn-secondary"><BarChart3 className="h-4 w-4" /> Complete Report</Link>
            <button onClick={handleExport} className="btn-primary"><Download className="h-4 w-4" /> Export CSV</button>
            <button onClick={handleDelete} className="btn-danger"><Trash2 className="h-4 w-4" /> Delete</button>
          </>
        }
      />

      {isLive && (
        <div className="mb-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
          Test is running with {run.multiThreading ?? run.configSnapshot?.multiThreading ?? 1} parallel browser(s).
          Each worker claims URLs independently until duration expires or you stop the run.
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="card"><p className="text-xs text-slate-400">Status</p><div className="mt-1"><StatusBadge status={run.status} /></div></div>
        <div className="card">
          <p className="text-xs text-slate-400">Elapsed Time</p>
          <p className="mt-1 text-xl font-bold font-mono">{formatDuration(displayElapsed)}</p>
          {durationSec != null && durationSec > 0 && (
            <p className="mt-1 text-xs text-slate-500">of {durationSec}s duration</p>
          )}
          {timeProgress != null && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${timeProgress}%` }} />
            </div>
          )}
        </div>
        <div className="card">
          <p className="text-xs text-slate-400">URLs tested</p>
          <p className="mt-1 text-xl font-bold">{staticResults.length}{run.urlsTotal > 0 ? ` / ${run.urlsTotal}` : ''}</p>
          {urlProgress != null && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${urlProgress}%` }} />
            </div>
          )}
        </div>
        <div className="card"><p className="text-xs text-slate-400">Pass / Fail</p><p className="mt-1 text-xl font-bold"><span className="text-emerald-600">{staticResults.filter((r) => r.testStatus === 'PASS').length}</span> / <span className="text-red-600">{staticResults.filter((r) => r.testStatus === 'FAIL').length}</span></p></div>
        <div className="card"><p className="text-xs text-slate-400">Avg Score</p><p className="mt-1 text-xl font-bold">{avgScore != null ? <ScoreBadge score={avgScore} /> : '—'}</p></div>
      </div>

      {run.mode === 'static' && (
        <div className="card overflow-hidden p-0">
          <div className="border-b border-slate-100 px-6 py-4"><h3 className="font-display font-semibold">Static / UEM Results ({staticResults.length})</h3></div>
          {staticResults.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-400">Waiting for results… Check that Maven/Java is running.</p>
          ) : (
            <DataTable scrollY maxHeight="500px" tableClassName="text-left text-xs">
              <thead className="sticky top-0 z-10 bg-slate-50 uppercase text-slate-400">
                <tr>
                  <th className="px-3 py-2">Transaction</th>
                  <th className="px-3 py-2">URL</th>
                  <th className="px-3 py-2 text-right">Score</th>
                  <th className="px-3 py-2 text-right">FCP</th>
                  <th className="px-3 py-2 text-right">LCP</th>
                  <th className="px-3 py-2 text-right">CLS</th>
                  <th className="px-3 py-2 text-right">TBT</th>
                  <th className="px-3 py-2 text-right">SI</th>
                  <th className="px-3 py-2 text-right">Page Load</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {staticResults.map((r, i) => (
                  <tr key={i} className="border-t border-slate-50">
                    <td className="px-3 py-2 font-medium" title={r.transaction}>
                      <span className="cell-truncate">{r.transaction}</span>
                    </td>
                    <td className="px-3 py-2" title={r.pageUrl}>
                      <span className="cell-truncate">{r.pageUrl}</span>
                    </td>
                    <td className="px-3 py-2 text-right"><ScoreBadge score={r.performanceScore} /></td>
                    <td className="px-3 py-2 text-right"><MetricCell value={r.fcp} status={fcpStatus(r.fcp)} /></td>
                    <td className="px-3 py-2 text-right"><MetricCell value={r.lcp} status={lcpStatus(r.lcp)} /></td>
                    <td className="px-3 py-2 text-right"><MetricCell value={r.cls} status={clsStatus(r.cls)} suffix="" /></td>
                    <td className="px-3 py-2 text-right"><MetricCell value={r.tbt} status={tbtStatus(r.tbt)} /></td>
                    <td className="px-3 py-2 text-right"><MetricCell value={r.speedIndex} status={siStatus(r.speedIndex)} /></td>
                    <td className="px-3 py-2 text-right font-mono">{Math.round(r.pageLoadTime)}ms</td>
                    <td className="px-3 py-2"><PassFailBadge status={r.testStatus} /></td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </div>
      )}

      {run.mode === 'scripted' && scriptedResults.length > 0 && (
        <div className="card p-6 text-sm text-slate-500">Scripted results loaded: {scriptedResults.length} steps</div>
      )}
    </>
  );
}
