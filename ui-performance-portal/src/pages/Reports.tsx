import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart3, Download, Trash2, Eye, RefreshCw, Search, Filter,
} from 'lucide-react';
import { PageHeader } from '../components/layout/AppLayout';
import { DataTable } from '../components/common/DataTable';
import { StatusBadge, ScoreBadge } from '../components/common/Badges';
import { api } from '../services/api';
import { formatDuration } from '../utils/formatDuration';
import type { RunMode, RunStatus, TestRun } from '../types';

function formatTestDuration(sec: number | null | undefined) {
  if (sec == null || sec === 0) return 'No limit';
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function runElapsed(run: TestRun): string {
  if (!run.startedAt) return '—';
  const start = new Date(run.startedAt).getTime();
  const end = run.endedAt ? new Date(run.endedAt).getTime() : Date.now();
  return formatDuration(end - start);
}

export default function Reports() {
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modeFilter, setModeFilter] = useState<'all' | RunMode>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | RunStatus>('all');
  const [exportingId, setExportingId] = useState<string | null>(null);

  const load = async () => {
    try {
      const data = await api.getRuns();
      setRuns(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return runs.filter((run) => {
      if (modeFilter !== 'all' && run.mode !== modeFilter) return false;
      if (statusFilter !== 'all' && run.status !== statusFilter) return false;
      if (!q) return true;
      return (
        run.runId.toLowerCase().includes(q)
        || run.hostname?.toLowerCase().includes(q)
        || run.crawlRunId?.toLowerCase().includes(q)
      );
    });
  }, [runs, search, modeFilter, statusFilter]);

  const summary = useMemo(() => {
    const withResults = runs.filter((r) => r.urlsCompleted > 0);
    const completed = runs.filter((r) => r.status === 'completed' || r.status === 'stopped');
    const scores = withResults
      .map((r) => r.avgPerformanceScore)
      .filter((s): s is number => s != null && s > 0);
    const totalPass = withResults.reduce((s, r) => s + r.passCount, 0);
    const totalFail = withResults.reduce((s, r) => s + r.failCount, 0);
    const passDenom = totalPass + totalFail;
    return {
      totalRuns: runs.length,
      runsWithData: withResults.length,
      completedRuns: completed.length,
      avgScore: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
      passRate: passDenom > 0 ? (totalPass / passDenom) * 100 : null,
      totalUrlsTested: withResults.reduce((s, r) => s + r.urlsCompleted, 0),
    };
  }, [runs]);

  const handleExport = async (run: TestRun) => {
    if (run.urlsCompleted === 0 && run.mode === 'static') {
      alert('No report data yet — wait for the run to produce results.');
      return;
    }
    setExportingId(run.runId);
    try {
      const blob = await api.exportRunCsv(run.runId, run.mode);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `Static_Run_Report_RunID_${run.runId}.csv`;
      a.click();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExportingId(null);
    }
  };

  const handleDelete = async (run: TestRun) => {
    if (!confirm(`Delete run ${run.runId} and all report files? This cannot be undone.`)) return;
    await api.deleteRun(run.runId);
    load();
  };

  const canViewReport = (run: TestRun) =>
    run.urlsCompleted > 0 || run.status === 'completed' || run.status === 'stopped';

  return (
    <>
      <PageHeader
        title="Reports & Analytics"
        subtitle="Browse all test runs, open complete reports, and export results"
        actions={
          <button onClick={load} className="btn-secondary" disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="card">
          <p className="text-xs text-slate-400">Total Runs</p>
          <p className="mt-1 text-2xl font-bold">{summary.totalRuns}</p>
          <p className="mt-1 text-xs text-slate-500">{summary.completedRuns} completed</p>
        </div>
        <div className="card">
          <p className="text-xs text-slate-400">Runs with Data</p>
          <p className="mt-1 text-2xl font-bold">{summary.runsWithData}</p>
          <p className="mt-1 text-xs text-slate-500">Have reportable results</p>
        </div>
        <div className="card">
          <p className="text-xs text-slate-400">URLs Tested</p>
          <p className="mt-1 text-2xl font-bold">{summary.totalUrlsTested}</p>
          <p className="mt-1 text-xs text-slate-500">Across all runs</p>
        </div>
        <div className="card">
          <p className="text-xs text-slate-400">Avg Performance Score</p>
          <p className="mt-1 text-2xl font-bold">
            {summary.avgScore != null ? <ScoreBadge score={summary.avgScore} /> : '—'}
          </p>
          <p className="mt-1 text-xs text-slate-500">Runs with Lighthouse data</p>
        </div>
        <div className="card">
          <p className="text-xs text-slate-400">Overall Pass Rate</p>
          <p className="mt-1 text-2xl font-bold text-emerald-600">
            {summary.passRate != null ? `${Math.round(summary.passRate)}%` : '—'}
          </p>
          <p className="mt-1 text-xs text-slate-500">Pass vs fail URLs</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 sm:max-w-xs">
          <label className="label" htmlFor="report-search">Search</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              id="report-search"
              className="input-field pl-9"
              placeholder="Run ID, host, crawl ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="min-w-0 sm:max-w-[9rem]">
          <label className="label" htmlFor="mode-filter">Mode</label>
          <select
            id="mode-filter"
            className="input-field"
            value={modeFilter}
            onChange={(e) => setModeFilter(e.target.value as typeof modeFilter)}
          >
            <option value="all">All modes</option>
            <option value="static">Static / UEM</option>
            <option value="scripted">Scripted</option>
          </select>
        </div>
        <div className="min-w-0 sm:max-w-[9rem]">
          <label className="label" htmlFor="status-filter">Status</label>
          <select
            id="status-filter"
            className="input-field"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          >
            <option value="all">All statuses</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="stopped">Stopped</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        <p className="flex items-center gap-1 pb-2 text-xs text-slate-500">
          <Filter className="h-3 w-3" /> {filtered.length} of {runs.length} runs
        </p>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="border-b border-slate-100 px-4 py-4 sm:px-6">
          <h3 className="font-display font-semibold">All Runs</h3>
          <p className="mt-1 text-xs text-slate-500">
            Open the complete report for charts, Lighthouse analysis, and go-live insights
          </p>
        </div>
        <DataTable scrollY maxHeight="calc(100vh - 22rem)" tableClassName="text-left text-sm">
          <colgroup>
            <col style={{ width: '6%' }} />
            <col style={{ width: '6%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '6%' }} />
            <col style={{ width: '5%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '6%' }} />
            <col style={{ width: '9rem' }} />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase text-slate-400">
            <tr>
              <th className="px-3 py-3">Run ID</th>
              <th className="px-3 py-3">Mode</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Started</th>
              <th className="px-3 py-3">Ended</th>
              <th className="px-3 py-3">Elapsed</th>
              <th className="px-3 py-3">Browser</th>
              <th className="px-3 py-3">Threads</th>
              <th className="px-3 py-3">URLs</th>
              <th className="px-3 py-3">Pass / Fail</th>
              <th className="px-3 py-3 text-center">Avg Score</th>
              <th className="overflow-visible whitespace-nowrap px-2 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((run) => {
              const startedLabel = run.startedAt ? new Date(run.startedAt).toLocaleString() : '—';
              const endedLabel = run.endedAt ? new Date(run.endedAt).toLocaleString() : '—';
              const duration = run.testDurationSeconds ?? run.configSnapshot?.testDurationSeconds;
              const browser = run.configSnapshot?.browserType ?? '—';
              const progressPct = run.urlsTotal > 0
                ? Math.min(100, (run.urlsCompleted / run.urlsTotal) * 100)
                : (run.urlsCompleted > 0 ? 100 : 0);
              const reportReady = canViewReport(run);

              return (
                <tr key={run.id} className="border-t border-slate-50 hover:bg-slate-50/50">
                  <td className="px-3 py-3">
                    <Link
                      to={`/app/runs/${run.runId}`}
                      className="font-mono text-xs font-semibold text-brand-600 hover:underline"
                      title={run.hostname ? `Host: ${run.hostname}` : undefined}
                    >
                      {run.runId}
                    </Link>
                    {run.crawlRunId && (
                      <p className="mt-0.5 text-[10px] text-slate-400" title="Source crawl">
                        crawl {run.crawlRunId}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-3 capitalize text-xs">{run.mode}</td>
                  <td className="px-3 py-3"><StatusBadge status={run.status} /></td>
                  <td className="px-3 py-3 text-xs text-slate-500" title={startedLabel}>
                    <span className="cell-truncate">{startedLabel}</span>
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-500" title={endedLabel}>
                    <span className="cell-truncate">{endedLabel}</span>
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-500" title={`Configured: ${formatTestDuration(duration)}`}>
                    {runElapsed(run)}
                  </td>
                  <td className="px-3 py-3 text-xs capitalize text-slate-500">{browser}</td>
                  <td className="px-3 py-3 text-center text-xs text-slate-500">
                    {run.multiThreading ?? run.configSnapshot?.multiThreading ?? '—'}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-all"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                      <span className="shrink-0 text-[11px] text-slate-500">
                        {run.urlsCompleted}/{run.urlsTotal || '?'}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-xs">
                    <span className="text-emerald-600">{run.passCount}</span>
                    {' / '}
                    <span className="text-red-600">{run.failCount}</span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    {run.avgPerformanceScore != null && run.avgPerformanceScore > 0
                      ? <ScoreBadge score={run.avgPerformanceScore} />
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="overflow-visible whitespace-nowrap px-2 py-2">
                    <div className="inline-flex flex-nowrap items-center gap-1">
                      {reportReady ? (
                        <Link
                          to={`/app/runs/${run.runId}/report`}
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-600 text-white shadow-sm transition hover:bg-brand-700"
                          title="View complete report"
                        >
                          <BarChart3 className="h-3.5 w-3.5" />
                        </Link>
                      ) : (
                        <button
                          type="button"
                          disabled
                          className="inline-flex h-7 w-7 shrink-0 cursor-not-allowed items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-300"
                          title="Report not available yet"
                        >
                          <BarChart3 className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <Link
                        to={`/app/runs/${run.runId}`}
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50"
                        title="View run details"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Link>
                      {run.mode === 'static' && (
                        <button
                          type="button"
                          onClick={() => handleExport(run)}
                          disabled={!reportReady || exportingId === run.runId}
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:opacity-40"
                          title="Export CSV"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDelete(run)}
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-red-600 shadow-sm transition hover:bg-red-50"
                        title="Delete run and reports"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!filtered.length && (
              <tr>
                <td colSpan={12} className="px-6 py-12 text-center text-sm text-slate-400">
                  {loading ? 'Loading runs…' : runs.length === 0
                    ? 'No runs yet. Start a test from Run Test.'
                    : 'No runs match your filters.'}
                </td>
              </tr>
            )}
          </tbody>
        </DataTable>
      </div>
    </>
  );
}
