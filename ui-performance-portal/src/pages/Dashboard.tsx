import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Play, Globe, Settings, Clapperboard, ArrowRight, RefreshCw, MoreHorizontal,
} from 'lucide-react';
import { PageHeader } from '../components/layout/AppLayout';
import { DataTable } from '../components/common/DataTable';
import { StatusBadge, ScoreBadge } from '../components/common/Badges';
import { api } from '../services/api';
import type { TestRun } from '../types';

function scoreBand(scorePct: number | null) {
  if (scorePct == null) return { label: '—', className: 'text-slate-400' };
  if (scorePct >= 90) return { label: 'Excellent', className: 'text-emerald-700' };
  if (scorePct >= 75) return { label: 'Good', className: 'text-emerald-600' };
  if (scorePct >= 50) return { label: 'Needs attn', className: 'text-amber-700' };
  return { label: 'Critical', className: 'text-red-600' };
}

function relativeStarted(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  const days = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString();
}

export default function Dashboard() {
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [loading, setLoading] = useState(true);

  const [syncing, setSyncing] = useState(false);

  const load = () => {
    api.getRuns()
      .then(setRuns)
      .finally(() => setLoading(false));
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await api.syncLegacyScripts();
      await load();
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  const stats = useMemo(() => {
    const active = runs.filter((r) => r.status === 'running' || r.status === 'crawling');
    const activeStatic = active.filter((r) => r.mode === 'static').length;
    const activeScripted = active.filter((r) => r.mode === 'scripted').length;

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const completedToday = runs.filter((r) => {
      if (r.status !== 'completed' && r.status !== 'failed' && r.status !== 'stopped') return false;
      const end = r.endedAt || r.startedAt;
      return end ? new Date(end).getTime() >= startOfDay.getTime() : false;
    });
    const passedToday = completedToday.filter((r) => r.status === 'completed' && r.failCount === 0).length;
    const failedToday = completedToday.filter((r) => r.status === 'failed' || r.failCount > 0).length;

    const weekAgo = Date.now() - 7 * 86400000;
    const recentScores = runs
      .filter((r) => r.avgPerformanceScore && r.avgPerformanceScore > 0 && new Date(r.startedAt).getTime() >= weekAgo)
      .map((r) => Math.round((r.avgPerformanceScore ?? 0) * 100));
    const avgScore = recentScores.length
      ? Math.round(recentScores.reduce((a, b) => a + b, 0) / recentScores.length)
      : null;

    const urlsCrawled = runs.reduce((s, r) => s + (r.urlsTotal || 0), 0);

    return {
      activeCount: active.length,
      activeStatic,
      activeScripted,
      completedToday: completedToday.length,
      passedToday,
      failedToday,
      avgScore,
      urlsCrawled,
    };
  }, [runs]);

  const band = scoreBand(stats.avgScore);

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Node API, Java project and config all connected."
        actions={
          <>
            <button type="button" onClick={handleSync} className="btn-secondary" disabled={syncing}>
              <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} /> Sync scripts
            </button>
            <Link to="/app/run-test" className="btn-primary"><Play className="h-4 w-4" /> New run</Link>
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="card">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Active runs</p>
          <p className="mt-2 font-display text-3xl font-bold text-slate-900">{stats.activeCount}</p>
          <p className="mt-1 text-xs text-slate-500">{stats.activeStatic} static · {stats.activeScripted} scripted</p>
        </div>
        <div className="card">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Completed today</p>
          <p className="mt-2 font-display text-3xl font-bold text-slate-900">{stats.completedToday}</p>
          <p className="mt-1 text-xs text-slate-500">{stats.passedToday} passed · {stats.failedToday} failed</p>
        </div>
        <div className="card">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Avg performance score</p>
          <div className="mt-2 flex items-end gap-3">
            <p className="font-display text-3xl font-bold text-slate-900">{stats.avgScore ?? '—'}</p>
            <span className={`mb-1 text-xs font-semibold uppercase ${band.className}`}>{band.label}</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">across last 7 days</p>
        </div>
        <div className="card">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">URLs crawled</p>
          <p className="mt-2 font-display text-3xl font-bold text-slate-900">{stats.urlsCrawled.toLocaleString()}</p>
          <p className="mt-1 text-xs text-slate-500">suite sizes this month</p>
        </div>
      </div>

      <div className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { to: '/app/crawler', icon: Globe, title: 'Start a crawl', sub: 'Discover URLs' },
          { to: '/app/configuration', icon: Settings, title: 'Update settings', sub: 'Configuration' },
          { to: '/app/script-studio', icon: Clapperboard, title: 'Manage scripts', sub: 'Script Studio' },
          { to: '/app/run-test', icon: Play, title: 'Launch a run', sub: 'Static or scripted' },
        ].map(({ to, icon: Icon, title, sub }) => (
          <Link
            key={to}
            to={to}
            className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-emerald-300 hover:bg-emerald-50/40"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-800">
              <Icon className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-slate-900">{title}</span>
              <span className="block text-xs text-slate-500">{sub}</span>
            </span>
          </Link>
        ))}
      </div>

      <div className="card overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="font-display font-semibold">Recent runs</h3>
          <Link to="/app/runs" className="inline-flex items-center gap-1 text-sm font-medium text-emerald-800 hover:underline">
            View run history <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <DataTable tableClassName="text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-400">
            <tr>
              <th className="px-4 py-3">Run ID</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Score</th>
              <th className="px-4 py-3">Started</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {runs.slice(0, 8).map((run) => {
              const scorePct = run.avgPerformanceScore != null && run.avgPerformanceScore > 0
                ? Math.round(run.avgPerformanceScore * 100)
                : null;
              const progress = run.status === 'running' && run.urlsTotal > 0
                ? ` · ${Math.round((run.urlsCompleted / run.urlsTotal) * 100)}%`
                : '';
              const source = run.scriptId || (run.crawlRunId ? `crawl_${run.crawlRunId}.csv` : run.mode === 'static' ? 'static suite' : 'scripted flow');
              return (
                <tr key={run.id} className="border-t border-slate-50 hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <Link to={`/app/runs/${run.runId}`} className="font-mono text-xs font-semibold text-emerald-800 hover:underline">
                      #{run.runId}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-xs uppercase tracking-wide text-slate-500">{run.mode}</td>
                  <td className="px-4 py-3 text-xs text-slate-500" title={source}>
                    <span className="cell-truncate max-w-[10rem]">{source}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={run.status} />
                      {progress && <span className="text-[11px] text-slate-400">{progress}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {scorePct != null ? <ScoreBadge score={scorePct / 100} /> : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{relativeStarted(run.startedAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link to={`/app/runs/${run.runId}`} className="inline-flex rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Open run">
                      <MoreHorizontal className="h-4 w-4" />
                    </Link>
                  </td>
                </tr>
              );
            })}
            {!runs.length && (
              <tr>
                <td colSpan={7} className="px-6 py-10 text-center text-sm text-slate-400">
                  {loading ? 'Loading runs…' : 'No runs yet. Launch your first test from Run Test.'}
                </td>
              </tr>
            )}
          </tbody>
        </DataTable>
      </div>
    </>
  );
}
