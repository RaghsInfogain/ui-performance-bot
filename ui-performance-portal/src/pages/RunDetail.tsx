import { useEffect, useMemo, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Download, BarChart3, RefreshCw, Trash2, Square } from 'lucide-react';
import { PageHeader } from '../components/layout/AppLayout';
import { DataTable } from '../components/common/DataTable';
import { StatusBadge } from '../components/common/Badges';
import { api } from '../services/api';
import { formatDuration, formatMs } from '../utils/formatDuration';
import {
  aggregatePageResults,
  clsStatus,
  fcpStatus,
  layerStatus,
  lcpStatus,
  navBreakdown,
  NEUTRAL_BADGE,
  pagePath,
  pageLighthouseStatus,
  scoreClass,
  siStatus,
  statusBadge,
  tbtStatus,
  vitalBadge,
} from '../utils/reportDesign';
import type { TestRun, StaticResultRow, ScriptedResultRow } from '../types';
import '../styles/runReport.css';

/** Metric value coloured by its Lighthouse rating; "—" until the metric has been measured. */
function MetricCell({ value, status, suffix = 'ms', measured = value > 0 }: {
  value: number; status: 'good' | 'warn' | 'poor'; suffix?: string; measured?: boolean;
}) {
  if (!measured) return <span className={`font-mono ${NEUTRAL_BADGE}`} title="Not measured yet">—</span>;
  const display = suffix === '' ? value.toFixed(3) : suffix === 'ms' ? formatMs(value) : `${Math.round(value)}${suffix}`;
  return <span className={`font-mono ${vitalBadge(status)}`}>{display}</span>;
}

/** Lighthouse performance score: 90–100 Good, 50–89 Needs Improvement, 0–49 Poor. */
function LhScore({ score }: { score: number }) {
  const pct = Math.round((score || 0) * 100);
  if (pct <= 0) return <span className={NEUTRAL_BADGE} title="Not measured yet">—</span>;
  return <span className={vitalBadge(scoreClass(pct))} title="Lighthouse performance score">{pct}</span>;
}

function PassFailBadge({ status }: { status: string }) {
  return <span className={vitalBadge(status === 'PASS' ? 'good' : 'poor')}>{status || '—'}</span>;
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

  const aggregated = useMemo(() => aggregatePageResults(staticResults), [staticResults]);

  const scriptedAgg = useMemo(() => {
    const map = new Map<string, { transaction: string; hits: number; passCount: number; failCount: number; lastStep: string; lastStatus: 'PASS' | 'FAIL' }>();
    for (const r of scriptedResults) {
      const key = r.transaction || r.testStepName || 'step';
      const cur = map.get(key) ?? {
        transaction: key,
        hits: 0,
        passCount: 0,
        failCount: 0,
        lastStep: '',
        lastStatus: 'PASS' as const,
      };
      cur.hits += 1;
      if (r.testStatus === 'FAIL') cur.failCount += 1;
      else cur.passCount += 1;
      cur.lastStep = r.testStepName || cur.lastStep;
      cur.lastStatus = r.testStatus;
      map.set(key, cur);
    }
    return [...map.values()];
  }, [scriptedResults]);

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
  const isScripted = run.mode === 'scripted';
  const durationSec = run.testDurationSeconds ?? run.configSnapshot?.testDurationSeconds ?? null;
  const durationMs = durationSec ? durationSec * 1000 : null;
  const startedMs = run.startedAt ? new Date(run.startedAt).getTime() : 0;
  const endedMs = run.endedAt ? new Date(run.endedAt).getTime() : null;
  const displayElapsed = startedMs
    ? (endedMs != null ? endedMs - startedMs : (isLive ? now - startedMs : elapsedMs))
    : 0;
  const timeProgress = durationMs ? Math.min(100, (displayElapsed / durationMs) * 100) : null;
  const uniqueCount = isScripted ? scriptedAgg.length : aggregated.length;
  const totalHits = isScripted
    ? scriptedResults.length
    : aggregated.reduce((s, r) => s + r.hits, 0);
  const totalPass = isScripted
    ? scriptedResults.filter((r) => r.testStatus === 'PASS').length
    : aggregated.reduce((s, r) => s + r.passCount, 0);
  const totalFail = isScripted
    ? scriptedResults.filter((r) => r.testStatus === 'FAIL').length
    : aggregated.reduce((s, r) => s + r.failCount, 0);
  const urlProgress = run.urlsTotal > 0
    ? Math.min(100, (uniqueCount / run.urlsTotal) * 100)
    : (totalHits > 0 ? Math.min(100, totalHits > 0 ? 50 : 0) : null);
  const scoresWithValues = aggregated.filter((r) => r.performanceScore > 0);
  const avgScore = !isScripted && scoresWithValues.length
    ? scoresWithValues.reduce((s, r) => s + r.performanceScore, 0) / scoresWithValues.length
    : null;

  return (
    <>
      <PageHeader
        title={`Run #${run.runId}`}
        subtitle={`${run.mode} · ${run.status}${run.hostname ? ` · ${run.hostname}` : ''}`}
        actions={
          <>
            {isLive && (
              <button onClick={handleStop} className="btn-danger"><Square className="h-4 w-4" /> Stop</button>
            )}
            <button onClick={load} className="btn-secondary"><RefreshCw className="h-4 w-4" /> Refresh</button>
            <Link to={`/app/runs/${run.runId}/report`} className="btn-primary"><BarChart3 className="h-4 w-4" /> Complete Report</Link>
            <button onClick={handleExport} className="btn-secondary"><Download className="h-4 w-4" /> Export CSV</button>
            <button onClick={handleDelete} className="btn-secondary text-red-600"><Trash2 className="h-4 w-4" /> Delete</button>
          </>
        }
      />

      {(timeProgress != null || urlProgress != null) && (
        <div className="mb-6 space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          {timeProgress != null && (
            <div>
              <div className="mb-1 flex justify-between text-xs text-slate-500">
                <span>Time elapsed</span>
                <span>{formatDuration(displayElapsed)}{durationMs ? ` / ${formatDuration(durationMs)}` : ''}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${timeProgress}%` }} />
              </div>
            </div>
          )}
          {urlProgress != null && (
            <div>
              <div className="mb-1 flex justify-between text-xs text-slate-500">
                <span>{isScripted ? 'Transactions / planned steps' : 'Unique pages / planned'}</span>
                <span>{uniqueCount}{run.urlsTotal ? ` / ${run.urlsTotal}` : ''} · {totalHits} hit(s)</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${urlProgress}%` }} />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="card"><p className="text-xs text-slate-400">Status</p><p className="mt-1"><StatusBadge status={run.status} /></p></div>
        <div className="card"><p className="text-xs text-slate-400">{isScripted ? 'Transactions' : 'Unique pages'}</p><p className="mt-1 text-xl font-bold">{uniqueCount}</p></div>
        <div className="card"><p className="text-xs text-slate-400">Total hits</p><p className="mt-1 text-xl font-bold">{totalHits}</p></div>
        <div className="card"><p className="text-xs text-slate-400">Pass / Fail</p><p className="mt-1 text-xl font-bold"><span className="text-emerald-600">{totalPass}</span> / <span className="text-red-600">{totalFail}</span></p></div>
        <div className="card"><p className="text-xs text-slate-400">Avg Score</p><p className="mt-1 text-xl font-bold">{avgScore != null ? <LhScore score={avgScore} /> : '—'}</p></div>
      </div>

      {run.mode === 'static' && (
        <div className="card overflow-hidden p-0">
          <div className="border-b border-slate-100 px-6 py-4">
            <h3 className="font-display font-semibold">Static / UEM Results ({aggregated.length} pages · {totalHits} hits)</h3>
            <p className="mt-1 text-xs text-slate-500">
              Lighthouse metrics are averaged over the hits that ran Lighthouse; navigation timing over all hits (Network + Server + Browser = Page Load).
              Colours follow Lighthouse ratings:{' '}
              <span className="rp-badge rp-badge--good">Good</span>{' '}
              <span className="rp-badge rp-badge--warn">Needs Improvement</span>{' '}
              <span className="rp-badge rp-badge--poor">Poor</span>.
              {' '}Status is the Lighthouse performance score rating (90–100 / 50–89 / 0–49) — hover it for the reason.
            </p>
          </div>
          {aggregated.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-400">Waiting for results… Check that Maven/Java is running.</p>
          ) : (
            <DataTable scrollY maxHeight="560px" tableClassName="uem-table min-w-[1120px] text-left">
              <colgroup>
                <col style={{ width: '13.5%' }} />
                <col style={{ width: '4.5%' }} />
                <col style={{ width: '6.5%' }} />
                <col style={{ width: '5%' }} />
                <col style={{ width: '6.5%' }} />
                <col style={{ width: '6.5%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '6.5%' }} />
                <col style={{ width: '6.5%' }} />
                <col style={{ width: '6.5%' }} />
                <col style={{ width: '6.5%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '13.5%' }} />
              </colgroup>
              <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500">
                <tr className="uem-table__groups">
                  <th colSpan={3} />
                  <th colSpan={6} className="uem-table__group">Lighthouse</th>
                  <th colSpan={4} className="uem-table__group">Navigation timing</th>
                  <th />
                </tr>
                <tr>
                  <th>Page</th>
                  <th className="text-right">Hits</th>
                  <th className="text-right" title="Passed / failed hits">Pass/Fail</th>
                  <th className="text-right">Score</th>
                  <th className="text-right">FCP</th>
                  <th className="text-right">LCP</th>
                  <th className="text-right">CLS</th>
                  <th className="text-right">TBT</th>
                  <th className="text-right">SI</th>
                  <th className="text-right" title="Redirects, DNS, connection and HTML download">Network</th>
                  <th className="text-right" title="Request sent → first byte">Server</th>
                  <th className="text-right" title="DOM processing, scripts, sub-resources and load event">Browser</th>
                  <th className="text-right leading-tight" style={{ whiteSpace: 'normal' }} title="navigationStart → loadEventEnd (Network + Server + Browser)">Page Load</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {aggregated.map((r) => {
                  const nav = navBreakdown(r);
                  const st = pageLighthouseStatus(r);
                  return (
                    <tr key={r.pageUrl}>
                      <td title={r.pageUrl}>
                        <span className="cell-truncate font-semibold text-slate-800">{r.transaction || pagePath(r.pageUrl)}</span>
                        <span className="cell-truncate text-[11px] text-slate-400">{pagePath(r.pageUrl)}</span>
                      </td>
                      <td className="text-right">{r.hits}</td>
                      <td className="text-right">
                        <span className="text-emerald-700">{r.passCount}</span>
                        <span className="text-slate-300"> / </span>
                        <span className={r.failCount ? 'text-red-700' : 'text-slate-400'}>{r.failCount}</span>
                      </td>
                      <td className="text-right"><LhScore score={r.performanceScore} /></td>
                      <td className="text-right"><MetricCell value={r.fcp} status={fcpStatus(r.fcp)} /></td>
                      <td className="text-right"><MetricCell value={r.lcp} status={lcpStatus(r.lcp)} /></td>
                      <td className="text-right"><MetricCell value={r.cls} status={clsStatus(r.cls)} suffix="" measured={r.lcp > 0} /></td>
                      <td className="text-right"><MetricCell value={r.tbt} status={tbtStatus(r.tbt)} /></td>
                      <td className="text-right"><MetricCell value={r.speedIndex} status={siStatus(r.speedIndex)} /></td>
                      <td className="text-right">{nav ? <MetricCell value={nav.network} status={layerStatus(nav.network, 'network')} measured /> : '—'}</td>
                      <td className="text-right">{nav ? <MetricCell value={nav.server} status={layerStatus(nav.server, 'server')} measured /> : '—'}</td>
                      <td className="text-right">{nav ? <MetricCell value={nav.browser} status={layerStatus(nav.browser, 'browser')} measured /> : '—'}</td>
                      <td className="text-right font-semibold text-slate-800">{nav ? formatMs(nav.pageLoad) : '—'}</td>
                      <td><span className={statusBadge(st.status)} title={st.reason}>{st.label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
          )}
        </div>
      )}

      {isScripted && (
        <div className="space-y-4">
          <div className="card overflow-hidden p-0">
            <div className="border-b border-slate-100 px-6 py-4">
              <h3 className="font-display font-semibold">Scripted transactions ({scriptedAgg.length} · {totalHits} hits)</h3>
              <p className="mt-1 text-xs text-slate-500">Each hit is one executed step row from the Java scripted runner.</p>
            </div>
            {scriptedAgg.length === 0 ? (
              <p className="p-8 text-center text-sm text-slate-400">
                {isLive ? 'Waiting for scripted hits…' : 'No scripted results found for this run.'}
              </p>
            ) : (
              <DataTable scrollY maxHeight="280px" tableClassName="text-left text-xs">
                <thead className="sticky top-0 z-10 bg-slate-50 uppercase text-slate-400">
                  <tr>
                    <th className="px-3 py-2">Transaction</th>
                    <th className="px-3 py-2 text-right">Hits</th>
                    <th className="px-3 py-2 text-right">Pass</th>
                    <th className="px-3 py-2 text-right">Fail</th>
                    <th className="px-3 py-2">Last step</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {scriptedAgg.map((r) => (
                    <tr key={r.transaction} className="border-t border-slate-50">
                      <td className="px-3 py-2 font-medium">{r.transaction}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.hits}</td>
                      <td className="px-3 py-2 text-right font-mono text-emerald-700">{r.passCount}</td>
                      <td className="px-3 py-2 text-right font-mono text-red-700">{r.failCount}</td>
                      <td className="px-3 py-2" title={r.lastStep}><span className="cell-truncate">{r.lastStep || '—'}</span></td>
                      <td className="px-3 py-2"><PassFailBadge status={r.lastStatus} /></td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </div>

          <div className="card overflow-hidden p-0">
            <div className="border-b border-slate-100 px-6 py-4">
              <h3 className="font-display font-semibold">Step log ({scriptedResults.length})</h3>
            </div>
            {scriptedResults.length === 0 ? (
              <p className="p-8 text-center text-sm text-slate-400">No step rows yet.</p>
            ) : (
              <DataTable scrollY maxHeight="420px" tableClassName="text-left text-xs">
                <thead className="sticky top-0 z-10 bg-slate-50 uppercase text-slate-400">
                  <tr>
                    <th className="px-3 py-2">Time</th>
                    <th className="px-3 py-2">Transaction</th>
                    <th className="px-3 py-2">Step</th>
                    <th className="px-3 py-2">Request</th>
                    <th className="px-3 py-2 text-right">Load Time</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Failure</th>
                  </tr>
                </thead>
                <tbody>
                  {scriptedResults.map((r, i) => (
                    <tr key={`${r.timestamp}-${i}`} className="border-t border-slate-50">
                      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{r.timestamp || '—'}</td>
                      <td className="px-3 py-2 font-medium">{r.transaction || '—'}</td>
                      <td className="px-3 py-2" title={r.testStepName}><span className="cell-truncate">{r.testStepName || '—'}</span></td>
                      <td className="px-3 py-2 font-mono" title={r.request}><span className="cell-truncate">{r.request || '—'}</span></td>
                      <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{formatMs(r.waitingElementLoadTime || r.pageLoadTime)}</td>
                      <td className="px-3 py-2"><PassFailBadge status={r.testStatus} /></td>
                      <td className="px-3 py-2 text-red-700" title={r.failureReason || undefined}>
                        <span className="cell-truncate">{r.failureReason || '—'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </div>
        </div>
      )}
    </>
  );
}
