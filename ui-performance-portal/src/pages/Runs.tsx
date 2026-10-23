import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Eye, Square, Trash2, BarChart3 } from 'lucide-react';
import { PageHeader } from '../components/layout/AppLayout';
import { DataTable } from '../components/common/DataTable';
import { StatusBadge } from '../components/common/Badges';
import { api } from '../services/api';
import type { BatchRunResult, TestRun } from '../types';

export default function Runs() {
  const [runs, setRuns] = useState<TestRun[]>([]);
  const batch = (useLocation().state as { batch?: BatchRunResult } | null)?.batch;

  const load = () => api.getRuns().then(setRuns);

  useEffect(() => {
    load();
    const interval = setInterval(load, 8000);
    return () => clearInterval(interval);
  }, []);

  const handleStop = async (runId: string) => {
    await api.stopRun(runId);
    load();
  };

  const handleDelete = async (runId: string) => {
    if (!confirm(`Delete run ${runId} and all result files?`)) return;
    await api.deleteRun(runId);
    load();
  };

  const formatDuration = (sec: number | null | undefined) => {
    if (sec == null || sec === 0) return 'No limit';
    if (sec < 60) return `${sec}s`;
    return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  };

  return (
    <>
      <PageHeader title="Run History" subtitle="Monitor active runs and browse past executions" actions={<Link to="/app/run-test" className="btn-primary">New Run</Link>} />

      {batch && (
        <div className="mb-4 rounded-lg bg-brand-50 p-4 text-sm text-slate-700">
          <div className="mb-1 font-semibold">
            Started {batch.runs.length} scripts with {batch.totalThreads} total thread{batch.totalThreads === 1 ? '' : 's'}
          </div>
          <ul className="space-y-0.5">
            {batch.runs.map((r) => (
              <li key={r.runId}>
                <Link to={`/app/runs/${r.runId}`} className="font-mono font-semibold text-brand-600 underline">{r.runId}</Link>
                {' '}— {r.scriptName} · {r.loadPercent}% · {r.multiThreading} thread{r.multiThreading === 1 ? '' : 's'}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card overflow-hidden p-0">
        <DataTable tableClassName="text-left text-sm">
          <colgroup>
            <col style={{ width: '8%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '15%' }} />
          </colgroup>
          <thead className="bg-slate-50 text-xs uppercase text-slate-400">
            <tr>
              <th className="px-3 py-3">Run ID</th>
              <th className="px-3 py-3">Mode</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Started</th>
              <th className="px-3 py-3">Duration</th>
              <th className="px-3 py-3">Threads</th>
              <th className="px-3 py-3">Progress</th>
              <th className="px-3 py-3">Pass / Fail</th>
              <th className="px-3 py-3">Score</th>
              <th className="px-3 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const duration = run.testDurationSeconds ?? run.configSnapshot?.testDurationSeconds;
              const progressPct = run.urlsTotal > 0
                ? Math.min(100, (run.urlsCompleted / run.urlsTotal) * 100)
                : (run.urlsCompleted > 0 ? 100 : 0);
              const startedLabel = run.startedAt ? new Date(run.startedAt).toLocaleString() : '—';
              return (
                <tr key={run.id} className="border-t border-slate-50 hover:bg-slate-50/50">
                  <td className="px-3 py-3 font-mono text-xs font-semibold text-brand-600">{run.runId}</td>
                  <td className="px-3 py-3 capitalize">{run.mode}</td>
                  <td className="px-3 py-3"><StatusBadge status={run.status} /></td>
                  <td className="px-3 py-3 text-xs text-slate-500" title={startedLabel}>
                    <span className="cell-truncate">{startedLabel}</span>
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-500">{formatDuration(duration)}</td>
                  <td className="px-3 py-3 text-center text-slate-500">{run.multiThreading ?? run.configSnapshot?.multiThreading ?? '—'}</td>
                  <td className="px-3 py-3">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-brand-500" style={{ width: `${progressPct}%` }} />
                      </div>
                      <span className="shrink-0 text-[11px] text-slate-500">{run.urlsCompleted}/{run.urlsTotal || '?'}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-xs">
                    <span className="text-emerald-600">{run.passCount}</span> / <span className="text-red-600">{run.failCount}</span>
                  </td>
                  <td className="px-3 py-3 text-center font-semibold">
                    {run.avgPerformanceScore != null && run.avgPerformanceScore > 0
                      ? Math.round(run.avgPerformanceScore * 100)
                      : '—'}
                  </td>
                  <td className="px-3 py-3">
                    <div className="inline-flex flex-nowrap items-center gap-1">
                      <Link to={`/app/runs/${run.runId}`} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50" title="View run"><Eye className="h-3.5 w-3.5" /></Link>
                      <Link
                        to={`/app/runs/${run.runId}/report`}
                        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-[#0f6e56] px-2 text-[11px] font-semibold text-white hover:bg-[#085041]"
                        title="View complete report"
                      >
                        <BarChart3 className="h-3.5 w-3.5" /> View Report
                      </Link>
                      {(run.status === 'running' || run.status === 'crawling') && (
                        <button onClick={() => handleStop(run.runId)} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-red-600 text-white" title="Stop run"><Square className="h-3.5 w-3.5" /></button>
                      )}
                      <button onClick={() => handleDelete(run.runId)} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-red-600 hover:bg-red-50" title="Delete run"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!runs.length && (
              <tr><td colSpan={10} className="px-6 py-8 text-center text-slate-400">No runs yet. Start one from Run Test.</td></tr>
            )}
          </tbody>
        </DataTable>
      </div>
    </>
  );
}
