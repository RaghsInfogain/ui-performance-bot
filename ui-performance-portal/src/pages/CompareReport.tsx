import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { PageHeader } from '../components/layout/AppLayout';
import { DataTable } from '../components/common/DataTable';
import { api } from '../services/api';
import type { RunComparison } from '../types';

function statusClass(status: string) {
  if (status === 'improved') return 'text-emerald-700 bg-emerald-50';
  if (status === 'degraded') return 'text-red-700 bg-red-50';
  if (status === 'mixed') return 'text-amber-700 bg-amber-50';
  return 'text-slate-600 bg-slate-50';
}

function fmt(val: number | null | undefined, unit: string) {
  if (val == null || Number.isNaN(val)) return '—';
  if (unit === 'score') return (val <= 1 ? val * 100 : val).toFixed(0);
  if (unit === '%') return `${val.toFixed(1)}%`;
  if (unit === 'cls') return val.toFixed(3);
  return `${Math.round(val)}`;
}

function fmtDelta(delta: number | null | undefined, unit: string) {
  if (delta == null) return '—';
  const sign = delta > 0 ? '+' : '';
  if (unit === 'score') return `${sign}${(delta <= 1 && Math.abs(delta) < 2 ? delta * 100 : delta).toFixed(1)}`;
  if (unit === 'cls') return `${sign}${delta.toFixed(3)}`;
  if (unit === '%') return `${sign}${delta.toFixed(1)}%`;
  return `${sign}${Math.round(delta)}`;
}

export default function CompareReport() {
  const [params] = useSearchParams();
  const baseline = params.get('baseline') || '';
  const current = params.get('current') || '';
  const [data, setData] = useState<RunComparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    if (!baseline || !current) {
      setError('Missing baseline or current run ID');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    api.compareRuns(baseline, current)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Compare failed'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [baseline, current]);

  if (loading) {
    return (
      <>
        <PageHeader title="Comparison Report" subtitle="Loading…" />
        <p className="text-slate-500">Building comparison…</p>
      </>
    );
  }

  if (error || !data) {
    return (
      <>
        <PageHeader title="Comparison Report" subtitle="Unable to compare" actions={<Link to="/app/reports" className="btn-secondary text-sm"><ArrowLeft className="h-4 w-4" /> Back</Link>} />
        <div className="rounded-lg bg-red-50 p-4 text-sm text-red-800">{error || 'No data'}</div>
        <button type="button" onClick={load} className="btn-primary mt-4"><RefreshCw className="h-4 w-4" /> Retry</button>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Comparison Report"
        subtitle={`Baseline ${data.baselineRunId} → Current ${data.currentRunId}`}
        actions={
          <div className="flex gap-2">
            <Link to="/app/reports" className="btn-secondary text-sm"><ArrowLeft className="h-4 w-4" /> Run & Report</Link>
            <button type="button" onClick={load} className="btn-secondary text-sm"><RefreshCw className="h-4 w-4" /> Refresh</button>
          </div>
        }
      />

      <div className={`mb-6 rounded-xl border px-5 py-4 ${statusClass(data.overall)}`}>
        <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Overall verdict</p>
        <p className="mt-1 font-display text-2xl font-bold capitalize">{data.overall}</p>
        <p className="mt-2 text-sm">{data.executiveSummary}</p>
      </div>

      <div className="mb-6 card overflow-hidden p-0">
        <div className="border-b px-4 py-3 font-semibold">Headline metrics (same heads as run report)</div>
        <DataTable tableClassName="text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-400">
            <tr>
              <th className="px-3 py-2">Metric</th>
              <th className="px-3 py-2">Baseline</th>
              <th className="px-3 py-2">Current</th>
              <th className="px-3 py-2">Delta</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.kpi.map((k) => (
              <tr key={k.key} className="border-t border-slate-50">
                <td className="px-3 py-2 font-medium">{k.label}</td>
                <td className="px-3 py-2 font-mono text-xs">{fmt(k.baseline, k.unit)}{k.unit === 'ms' ? ' ms' : ''}</td>
                <td className="px-3 py-2 font-mono text-xs">{fmt(k.current, k.unit)}{k.unit === 'ms' ? ' ms' : ''}</td>
                <td className="px-3 py-2 font-mono text-xs">{fmtDelta(k.delta, k.unit)}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${statusClass(k.status)}`}>{k.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h3 className="mb-3 font-semibold">Score by page</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.charts.scores}>
                <XAxis dataKey="name" hide />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <Legend />
                <Bar dataKey="baseline" fill="#94a3b8" name={`Baseline ${data.baselineRunId}`} />
                <Bar dataKey="current" fill="#0f6e56" name={`Current ${data.currentRunId}`} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <h3 className="mb-3 font-semibold">LCP by page (ms)</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.charts.lcp}>
                <XAxis dataKey="name" hide />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="baseline" fill="#94a3b8" name={`Baseline ${data.baselineRunId}`} />
                <Bar dataKey="current" fill="#0f6e56" name={`Current ${data.currentRunId}`} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="border-b px-4 py-3 font-semibold">Per-page comparison</div>
        <DataTable tableClassName="text-left text-xs" scrollY maxHeight="480px">
          <thead className="bg-slate-50 text-slate-400 uppercase">
            <tr>
              <th className="px-3 py-2">Page</th>
              <th className="px-3 py-2">Score Δ</th>
              <th className="px-3 py-2">LCP Δ</th>
              <th className="px-3 py-2">FCP Δ</th>
              <th className="px-3 py-2">TBT Δ</th>
              <th className="px-3 py-2">CLS Δ</th>
              <th className="px-3 py-2">Load Δ</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.pages.map((p) => (
              <tr key={p.pageUrl} className="border-t border-slate-50">
                <td className="px-3 py-2" title={p.pageUrl}>
                  <div className="font-medium">{p.transaction || '—'}</div>
                  <div className="cell-truncate text-slate-400">{p.pageUrl}</div>
                </td>
                <td className="px-3 py-2 font-mono">{p.deltas ? fmtDelta((p.deltas.score || 0) * 100, 'score') : '—'}</td>
                <td className="px-3 py-2 font-mono">{fmtDelta(p.deltas?.lcp ?? null, 'ms')}</td>
                <td className="px-3 py-2 font-mono">{fmtDelta(p.deltas?.fcp ?? null, 'ms')}</td>
                <td className="px-3 py-2 font-mono">{fmtDelta(p.deltas?.tbt ?? null, 'ms')}</td>
                <td className="px-3 py-2 font-mono">{fmtDelta(p.deltas?.cls ?? null, 'cls')}</td>
                <td className="px-3 py-2 font-mono">{fmtDelta(p.deltas?.pageLoad ?? null, 'ms')}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${statusClass(p.status)}`}>{p.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </div>
    </>
  );
}
