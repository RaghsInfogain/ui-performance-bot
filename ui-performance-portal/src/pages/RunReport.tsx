import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Download, ArrowLeft, RefreshCw, ExternalLink, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../services/api';
import type { RunReportAnalysis, RunReportMeta, GoLiveAnalysis } from '../types';
import type { AggregatedPageRow, ReportPageRow } from '../utils/reportDesign';
import {
  buildExecutiveSummary,
  clsStatus,
  computeOverallSystemStatus,
  fcpStatus,
  fmtMs,
  hostFromRows,
  siteFromRows,
  navBreakdown,
  avgNav,
  inpStatus,
  layerStatus,
  lhStatusLabel,
  lcpStatus,
  mergeAggregatedReportRows,
  pagePath,
  scoreBandKey,
  scoreBarColor,
  bandBarColor,
  siStatus,
  tbtStatus,
  ttfbStatus,
  vitalBadge,
} from '../utils/reportDesign';
import { formatMs } from '../utils/formatDuration';
import { exportReportHtml } from '../utils/exportReportHtml';
import '../styles/runReport.css';

function buildIssues(rows: AggregatedPageRow[]) {
  const issues: Array<{
    severity: string;
    issue: string;
    examples: string;
    description: string;
    impact: string;
    recommendation: string;
  }> = [];

  const slowLcp = rows.filter((r) => lcpStatus(r.lcp) === 'poor');
  if (slowLcp.length) {
    issues.push({
      severity: 'Critical',
      issue: 'Slow Largest Contentful Paint',
      examples: slowLcp.slice(0, 3).map((r) => pagePath(r.pageUrl)).join(', '),
      description: `${slowLcp.length} page(s) paint the largest visible element after 4s, typically due to heavy images, late fonts, or render-blocking resources on ${hostFromRows(rows)}.`,
      impact: `+${Math.round((slowLcp.reduce((s, r) => s + r.lcp, 0) / slowLcp.length - 2500) / 1000 * 10) / 10}s average LCP above the 2.5s good threshold on affected pages.`,
      recommendation: `Compress hero/above-the-fold images to WebP/AVIF, add responsive srcset, preload the LCP image, and defer non-critical CSS/JS on ${hostFromRows(rows)}.`,
    });
  }

  const slowTbt = rows.filter((r) => tbtStatus(r.tbt) === 'poor');
  if (slowTbt.length) {
    issues.push({
      severity: 'Critical',
      issue: 'High Total Blocking Time',
      examples: slowTbt.slice(0, 3).map((r) => pagePath(r.pageUrl)).join(', '),
      description: `${slowTbt.length} page(s) show main-thread blocking above 500ms — often third-party scripts or large JS bundles loading synchronously.`,
      impact: `Interactive delay averages ${Math.round(slowTbt.reduce((s, r) => s + r.tbt, 0) / slowTbt.length)}ms TBT on affected pages.`,
      recommendation: 'Add async/defer to non-critical scripts, split bundles, and lazy-load widgets (chat, analytics) after first interaction.',
    });
  }

  const badCls = rows.filter((r) => clsStatus(r.cls) === 'poor' || clsStatus(r.cls) === 'warn');
  if (badCls.length) {
    issues.push({
      severity: badCls.some((r) => clsStatus(r.cls) === 'poor') ? 'Needs attn.' : 'Watch',
      issue: 'Layout shift from late assets',
      examples: badCls.slice(0, 3).map((r) => pagePath(r.pageUrl)).join(', '),
      description: `${badCls.length} page(s) exceed CLS guidance, commonly from images/fonts without reserved space.`,
      impact: `Average CLS ${((badCls.reduce((s, r) => s + r.cls, 0) / badCls.length) || 0).toFixed(2)} on affected pages.`,
      recommendation: 'Set explicit width/height on images, use font-display: swap, and reserve space for ads/embeds.',
    });
  }

  const slowTtfb = rows.filter((r) => ttfbStatus(navBreakdown(r)?.ttfb ?? 0) !== 'good');
  if (slowTtfb.length) {
    issues.push({
      severity: 'Needs attn.',
      issue: 'Elevated Time to First Byte',
      examples: slowTtfb.slice(0, 3).map((r) => pagePath(r.pageUrl)).join(', '),
      description: `${slowTtfb.length} page(s) wait too long for the first byte — origin latency, missing CDN, or uncached HTML.`,
      impact: `Server/response time averages ${Math.round(slowTtfb.reduce((s, r) => s + (navBreakdown(r)?.ttfb ?? 0), 0) / slowTtfb.length)}ms on affected pages.`,
      recommendation: 'Enable edge caching/CDN for HTML where safe, optimize origin TTFB, and compress responses.',
    });
  }

  if (!issues.length) {
    issues.push({
      severity: 'Watch',
      issue: 'No critical CWV failures detected',
      examples: '—',
      description: 'Audited pages largely meet Core Web Vital thresholds for this run.',
      impact: 'Low immediate risk to user experience from measured CWVs.',
      recommendation: 'Keep monitoring with recurring runs and watch regressions on new releases.',
    });
  }
  return issues;
}

function buildOptPhases(rows: AggregatedPageRow[], host: string, issues: ReturnType<typeof buildIssues>) {
  return issues.filter((i) => i.severity !== 'Watch').slice(0, 3).map((issue, idx) => {
    const related = rows.filter((r) =>
      issue.issue.includes('LCP') ? lcpStatus(r.lcp) !== 'good'
        : issue.issue.includes('Blocking') ? tbtStatus(r.tbt) !== 'good'
          : issue.issue.includes('Layout') ? clsStatus(r.cls) !== 'good'
            : ttfbStatus(navBreakdown(r)?.ttfb ?? 0) !== 'good',
    );
    const sample = related[0] || rows[0];
    const beforeLcp = sample ? (sample.lcp / 1000).toFixed(1) : '—';
    const afterLcp = sample ? Math.max(1.2, sample.lcp / 1000 * 0.45).toFixed(1) : '—';
    const beforeScore = sample ? Math.round(sample.performanceScore * 100) : 0;
    const afterScore = Math.min(95, beforeScore + 25);
    return {
      phase: idx + 1,
      severity: issue.severity,
      title: issue.issue,
      resources: related.slice(0, 4).map((r) => pagePath(r.pageUrl)).join('\n') || `Key templates on ${host}`,
      pagesImpacted: `${related.length || rows.length} pages on ${host}`,
      whatToFix: issue.description,
      howToFix: issue.recommendation.split(/(?<=\.)\s+/).filter(Boolean).map((s, i) => `${i + 1}. ${s}`),
      impact: [
        { metric: 'LCP', before: `${beforeLcp}s`, after: `${afterLcp}s` },
        { metric: 'Perf. score', before: String(beforeScore), after: String(afterScore) },
      ],
    };
  });
}

/** DNS / connection time: 0 means the browser reused an open connection, not missing data. */
function ConnTime({ ms }: { ms: number }) {
  if (ms > 0) return <>{formatMs(ms)}</>;
  return <span className="run-report__muted" title="0 ms — the browser reused an open connection / cached DNS">reused</span>;
}

export default function RunReport() {
  const { runId } = useParams<{ runId: string }>();
  const [rows, setRows] = useState<AggregatedPageRow[]>([]);
  const [analysis, setAnalysis] = useState<RunReportAnalysis | null>(null);
  const [llmAnalysis, setLlmAnalysis] = useState<GoLiveAnalysis | null>(null);
  const [meta, setMeta] = useState<(RunReportMeta & { cached?: boolean; generatedAt?: string; generator?: string }) | null>(null);
  const [runMeta, setRunMeta] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uemOpen, setUemOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  const [regenerating, setRegenerating] = useState(false);
  const [exportingHtml, setExportingHtml] = useState(false);

  const load = (regenerate = false) => {
    if (!runId) {
      setLoading(false);
      setError('Invalid run ID');
      return;
    }
    setLoading(true);
    setError('');
    const reportPromise: Promise<{
      results?: import('../types').StaticResultRow[];
      pages?: import('../types').RunReportPage[];
      analysis?: RunReportAnalysis | null;
      llmAnalysis?: GoLiveAnalysis | null;
      meta?: RunReportMeta & { cached?: boolean; generatedAt?: string; generator?: string };
    }> = regenerate
      ? api.regenerateRunReport(runId)
      : api.getRunReport(runId);
    Promise.all([
      reportPromise,
      api.getRun(runId).catch(() => null),
    ])
      .then(([r, run]) => {
        setRows(mergeAggregatedReportRows(r.results ?? [], r.pages ?? []));
        setAnalysis(r.analysis ?? null);
        setLlmAnalysis(r.llmAnalysis ?? null);
        setMeta(r.meta ?? null);
        setRunMeta(run as unknown as Record<string, unknown> | null);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Failed to load report');
        setAnalysis(null);
      })
      .finally(() => {
        setLoading(false);
        setRegenerating(false);
      });
  };

  useEffect(() => { load(false); }, [runId]);

  const handleRegenerate = () => {
    if (!confirm('Re-generate this report from raw results? The saved report will be replaced.')) return;
    setRegenerating(true);
    load(true);
  };

  if (loading) {
    return (
      <div className="run-report">
        <p style={{ color: 'var(--rp-ink-mid)' }}>
          {regenerating ? `Re-generating report for run ${runId}…` : `Loading report for run ${runId}…`}
        </p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="run-report">
        <div style={{ background: '#FEF2F2', color: '#B91C1C', padding: 16, borderRadius: 8, marginBottom: 16 }}>{error}</div>
        <button onClick={() => load(false)} className="btn-primary"><RefreshCw className="h-4 w-4" /> Retry</button>
      </div>
    );
  }
  if (!analysis) {
    return (
      <div className="run-report">
        <p>No report data for run {runId}.</p>
        <Link to={`/app/runs/${runId}`} className="btn-secondary mt-4 inline-flex">Back to Run Detail</Link>
      </div>
    );
  }

  const { summary, charts } = analysis;
  const host = hostFromRows(rows);
  const site = siteFromRows(rows);
  const avgScorePct = rows.length
    ? Math.round(rows.reduce((s, r) => s + (r.performanceScore || 0) * 100, 0) / rows.length)
    : summary.avgScore;
  const bandCounts = { critical: 0, needs: 0, good: 0, excellent: 0 };
  for (const row of rows) {
    bandCounts[scoreBandKey(Math.round(row.performanceScore * 100))] += 1;
  }
  const overall = computeOverallSystemStatus(rows);
  const issues = buildIssues(rows);
  const phases = buildOptPhases(rows, host, issues);
  const criticalIssueCount = issues.filter((i) => i.severity === 'Critical').length;
  const cfg = (runMeta?.configSnapshot as Record<string, unknown> | undefined) ?? {};
  const scoreChartData = (charts.scores || []).map((s) => ({ ...s, fill: scoreBarColor(s.score) }));

  const avg = (fn: (r: AggregatedPageRow) => number) =>
    rows.length ? rows.reduce((s, r) => s + fn(r), 0) / rows.length : 0;
  // Phases sum to the average page load (navigationStart → loadEventEnd)
  const phaseRows = ([
    ['Redirect / request queueing', 'Network', 'redirectQueue'],
    ['DNS Lookup', 'Network', 'dns'],
    ['Initial Connection / SSL', 'Network', 'connection'],
    ['Server wait (request → first byte)', 'Server', 'serverWait'],
    ['Content Download', 'Network', 'download'],
    ['DOM Processing', 'Browser', 'domProcessing'],
    ['Scripts & sub-resources', 'Browser', 'scriptTime'],
    ['Load Event', 'Browser', 'loadEvent'],
  ] as const).map(([phase, category, key]) => ({ phase, category, avg: Math.round(avgNav(rows, key)) }));
  const totalPhase = Math.max(1, phaseRows.reduce((sum, p) => sum + p.avg, 0));
  const avgTtfb = Math.round(avgNav(rows, 'ttfb'));

  const catAvg = (key: 'accessibilityScore' | 'bestPracticesScore' | 'seoScore') => {
    const vals = rows.map((r) => Number(r[key] || 0)).filter((v) => v > 0);
    if (!vals.length) return null;
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100);
  };
  const a11y = catAvg('accessibilityScore');
  const bp = catAvg('bestPracticesScore');
  const seo = catAvg('seoScore');

  const avgNetwork = Math.round(avgNav(rows, 'network'));
  const avgServer = Math.round(avgNav(rows, 'server'));
  const avgBrowser = Math.round(avgNav(rows, 'browser'));
  const generatedAt = rows[0]?.timestamp
    ? new Date(rows[0].timestamp).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
    : new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

  const aggAvgLcp = avg((r) => r.lcp || 0);
  const aggAvgFcp = avg((r) => r.fcp || 0);
  const aggAvgCls = avg((r) => r.cls || 0);
  const aggAvgTbt = avg((r) => r.tbt || 0);
  const aggAvgSi = avg((r) => r.speedIndex || 0);
  const aggAvgPageLoad = avg((r) => r.pageLoadTime || 0);
  const totalHits = rows.reduce((s, r) => s + (r.hits || 1), 0);

  const cwvRows = [
    { metric: 'Largest Contentful Paint (LCP)', avg: aggAvgLcp, threshold: '2.5s', status: lcpStatus(aggAvgLcp), display: `${(aggAvgLcp / 1000).toFixed(1)}s` },
    { metric: 'Interaction to Next Paint (INP)*', avg: aggAvgTbt, threshold: '200ms', status: inpStatus(aggAvgTbt), display: `${Math.round(aggAvgTbt)}ms` },
    { metric: 'Cumulative Layout Shift (CLS)', avg: aggAvgCls, threshold: '0.1', status: clsStatus(aggAvgCls), display: aggAvgCls.toFixed(2) },
    { metric: 'First Contentful Paint (FCP)', avg: aggAvgFcp, threshold: '1.8s', status: fcpStatus(aggAvgFcp), display: `${(aggAvgFcp / 1000).toFixed(1)}s` },
    { metric: 'Total Blocking Time (TBT)', avg: aggAvgTbt, threshold: '200ms', status: tbtStatus(aggAvgTbt), display: `${Math.round(aggAvgTbt)}ms` },
    { metric: 'Speed Index', avg: aggAvgSi, threshold: '3.4s', status: siStatus(aggAvgSi), display: `${(aggAvgSi / 1000).toFixed(1)}s` },
  ];

  /** Go-live verdict: the analyst (LLM) assessment when available, else the percentile model. */
  const goLive = llmAnalysis
    ? {
      key: llmAnalysis.verdict.toLowerCase().replace(/_/g, '-'),
      label: llmAnalysis.verdictLabel,
      source: llmAnalysis.generatedBy,
      summary: llmAnalysis.executiveSummary,
      metric: `${Math.round(llmAnalysis.confidence * 100)}%`,
      metricLabel: 'confidence',
      blockers: llmAnalysis.justification?.blockers ?? [],
    }
    : {
      key: overall.status === 'healthy' ? 'go-live' : overall.status === 'critical' ? 'not-go-live' : 'conditional',
      label: overall.status === 'healthy' ? 'Ready to go live' : overall.status === 'critical' ? 'Not ready to go live' : 'Conditional go-live',
      source: 'Percentile model',
      summary: overall.justification,
      metric: String(overall.p75),
      metricLabel: 'p75 score',
      blockers: [] as string[],
    };

  const exec = buildExecutiveSummary({
    host,
    runId: String(runId),
    rows,
    threads: (runMeta?.multiThreading as string | number | null | undefined) ?? null,
    overallLabel: overall.label,
    overallJustification: overall.justification,
  });

  /** Save the report exactly as shown, with every collapsible section expanded. */
  const handleHtmlExport = async () => {
    const root = document.querySelector<HTMLElement>('.run-report');
    if (!root || !runId) return;
    const wasOpen = { uem: uemOpen, nav: navOpen };
    setExportingHtml(true);
    setUemOpen(true);
    setNavOpen(true);
    // let the expanded sections and their charts render before capturing
    await new Promise((r) => setTimeout(r, 400));
    try {
      exportReportHtml(root, {
        title: `Website Performance Report — Run #${runId}`,
        fileName: `Website_Performance_Report_RunID_${runId}.html`,
      });
    } finally {
      setUemOpen(wasOpen.uem);
      setNavOpen(wasOpen.nav);
      setExportingHtml(false);
    }
  };

  const handleExport = async () => {
    if (!runId) return;
    const mode = String(runMeta?.mode ?? meta?.mode ?? 'static');
    const blob = await api.exportRunCsv(runId, mode === 'scripted' ? 'scripted' : 'static');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = mode === 'scripted'
      ? `ScriptedFlow_Test_${runId}_Results.csv`
      : `Static_Run_Report_RunID_${runId}.csv`;
    a.click();
  };

  return (
    <div className="run-report">
      <div className="run-report__toolbar">
        <button type="button" onClick={() => load(false)} className="btn-secondary text-xs"><RefreshCw className="h-3 w-3" /> Refresh</button>
        <Link to="/app/reports" className="btn-secondary text-xs"><ArrowLeft className="h-3 w-3" /> Run & Report</Link>
        <Link to={`/app/runs/${runId}`} className="btn-secondary text-xs">Run Detail</Link>
        {meta?.cached && meta?.generatedAt && (
          <span className="text-xs text-slate-500">Saved {new Date(meta.generatedAt).toLocaleString()}</span>
        )}
        <button type="button" onClick={handleRegenerate} disabled={regenerating} className="btn-secondary text-xs">
          <RefreshCw className={`h-3 w-3 ${regenerating ? 'animate-spin' : ''}`} /> Re-generate
        </button>
        <button type="button" onClick={handleHtmlExport} disabled={exportingHtml} className="btn-secondary text-xs">
          <ExternalLink className="h-3 w-3" /> {exportingHtml ? 'Exporting…' : 'HTML Export'}
        </button>
        <button onClick={handleExport} className="btn-primary text-xs"><Download className="h-3 w-3" /> CSV</button>
      </div>

      <header className="run-report__cover">
        <div className="run-report__cover-kicker">UI Performance Bot</div>
        <h1 className="run-report__cover-title">Website Performance Report</h1>
        <div className="run-report__cover-meta">
          <div><span>Client / host</span><strong>{site?.client ?? '—'}</strong></div>
          <div>
            <span>Website tested</span>
            <strong>{site ? <a href={site.origin} target="_blank" rel="noreferrer" className="run-report__cover-link">{site.origin.replace(/^https?:\/\//, '')}</a> : '—'}</strong>
          </div>
          <div><span>Run ID</span><strong>#{runId}</strong></div>
          <div><span>Prepared by</span><strong>UI Performance Bot · Automated Test Engine</strong></div>
          <div><span>Generated</span><strong>{generatedAt}</strong></div>
        </div>

        <div className="run-report__cover-status">
          <div className={`run-report__system-status run-report__system-status--${overall.status}`}>
            <div className="run-report__system-status-label">{overall.label}</div>
            <div className="run-report__system-status-meta">
              p75 score {overall.p75} · p90 score {overall.p90} · {Math.round(overall.goodBandPct)}% pages in Good (90–100)
            </div>
            <p className="run-report__system-status-why"><strong>Justification:</strong> {overall.justification}</p>
          </div>

          <div className={`run-report__cover-golive run-report__cover-golive--${goLive.key}`}>
            <div className="run-report__cover-golive-head">
              <div>
                <div className="run-report__cover-golive-kicker">Go-live assessment · {goLive.source}</div>
                <div className="run-report__cover-golive-title">{goLive.label}</div>
              </div>
              <div className="run-report__cover-golive-metric">
                <div className="num">{goLive.metric}</div>
                <div className="lbl">{goLive.metricLabel}</div>
              </div>
            </div>
            <p className="run-report__cover-golive-why">{goLive.summary}</p>
            {goLive.blockers.length > 0 && (
              <p className="run-report__cover-golive-blockers">
                <strong>{goLive.blockers.length} blocker{goLive.blockers.length === 1 ? '' : 's'}:</strong> {goLive.blockers.slice(0, 2).join(' · ')}
                {goLive.blockers.length > 2 ? ' …' : ''}
              </p>
            )}
          </div>
        </div>
      </header>

      {/* 1 */}
      <section className="run-report__block">
        <h2 className="run-report__h2"><span>1</span> Test Summary</h2>
        <div className="run-report__summary-row-label">Run at a glance</div>
        <div className="run-report__summary-grid">
          <div className="run-report__kpi"><div className="lbl">Pages tested</div><div className="num">{rows.length}</div><div className="sub">{totalHits} hits</div></div>
          <div className={`run-report__kpi run-report__kpi--${scoreBandKey(avgScorePct)}`}><div className="lbl">Overall score</div><div className="num">{avgScorePct}/100</div><div className="sub">{overall.label}</div></div>
          <div className={`run-report__kpi ${criticalIssueCount ? 'run-report__kpi--critical' : 'run-report__kpi--excellent'}`}><div className="lbl">Critical issues</div><div className="num">{criticalIssueCount}</div><div className="sub">{criticalIssueCount ? 'need fixing before go-live' : 'none found'}</div></div>
          <div className={`run-report__kpi ${summary.avgPageLoad > 4000 ? 'run-report__kpi--critical' : summary.avgPageLoad > 2500 ? 'run-report__kpi--needs' : 'run-report__kpi--excellent'}`}><div className="lbl">Average load time</div><div className="num">{formatMs(summary.avgPageLoad)}</div><div className="sub">target ≤ 2.5 s</div></div>
        </div>
        <div className="run-report__summary-row-label">Pages by score band</div>
        <div className="run-report__summary-grid">
          <div className="run-report__band-card run-report__band-card--critical"><div className="lbl">Critical 0–49</div><div className="num">{bandCounts.critical}</div><div className="sub">pages · {summary.total ? Math.round((bandCounts.critical / summary.total) * 100) : 0}%</div></div>
          <div className="run-report__band-card run-report__band-card--needs"><div className="lbl">Needs attention 50–74</div><div className="num">{bandCounts.needs}</div><div className="sub">pages · {summary.total ? Math.round((bandCounts.needs / summary.total) * 100) : 0}%</div></div>
          <div className="run-report__band-card run-report__band-card--good"><div className="lbl">Good 75–89</div><div className="num">{bandCounts.good}</div><div className="sub">pages · {summary.total ? Math.round((bandCounts.good / summary.total) * 100) : 0}%</div></div>
          <div className="run-report__band-card run-report__band-card--excellent"><div className="lbl">Excellent 90–100</div><div className="num">{bandCounts.excellent}</div><div className="sub">pages · {summary.total ? Math.round((bandCounts.excellent / summary.total) * 100) : 0}%</div></div>
        </div>
      </section>

      {/* 2 */}
      <section className="run-report__block">
        <h2 className="run-report__h2"><span>2</span> Executive Summary &amp; Status Categorisation</h2>
        <div className="run-report__exec-body">
          {exec.paragraphs.map((p) => (
            <p key={p.slice(0, 48)} className="run-report__prose">{p}</p>
          ))}
          {llmAnalysis?.executiveSummary ? (
            <p className="run-report__prose run-report__prose--muted"><em>Go-live analyst note:</em> {llmAnalysis.executiveSummary}</p>
          ) : null}
        </div>

        <div className="run-report__half-grid">
        <div className="run-report__ux-impact">
          <h3 className="run-report__h3">User experience metrics — facts &amp; user impact</h3>
          <div className="run-report__ux-grid">
            <article className={`run-report__ux-card run-report__ux-card--${exec.ux.loading.status}`}>
              <div className="lbl">Loading experience</div>
              <div className="status">{lhStatusLabel(exec.ux.loading.status)}</div>
              <p>FCP {(exec.ux.loading.fcp / 1000).toFixed(1)}s · LCP {(exec.ux.loading.lcp / 1000).toFixed(1)}s · SI {(exec.ux.loading.si / 1000).toFixed(1)}s</p>
              <p className="impact"><strong>User impact:</strong> {exec.ux.loading.impact}</p>
            </article>
            <article className={`run-report__ux-card run-report__ux-card--${exec.ux.stability.status}`}>
              <div className="lbl">Visual stability</div>
              <div className="status">{lhStatusLabel(exec.ux.stability.status)}</div>
              <p>CLS {exec.ux.stability.cls.toFixed(2)}</p>
              <p className="impact"><strong>User impact:</strong> {exec.ux.stability.impact}</p>
            </article>
            <article className={`run-report__ux-card run-report__ux-card--${exec.ux.interactivity.status}`}>
              <div className="lbl">Interactivity</div>
              <div className="status">{lhStatusLabel(exec.ux.interactivity.status)}</div>
              <p>TBT {Math.round(exec.ux.interactivity.tbt)}ms (INP approx.)</p>
              <p className="impact"><strong>User impact:</strong> {exec.ux.interactivity.impact}</p>
            </article>
          </div>
        </div>

        <div className="run-report__layer-impact">
          <h3 className="run-report__h3">Navigation layers — dominant wait &amp; threshold impact</h3>
          <p className="run-report__prose">Dominant layer: <strong>{exec.layers.dominant}</strong> (largest average share of end-to-end wait).</p>
          <div className="run-report__ux-grid">
            {([
              ['Network', exec.layers.network],
              ['Browser', exec.layers.browser],
              ['Server', exec.layers.server],
            ] as const).map(([name, layer]) => (
              <article key={name} className={`run-report__ux-card run-report__ux-card--${layer.status}`}>
                <div className="lbl">{name}</div>
                <div className="status">{lhStatusLabel(layer.status)}</div>
                <p>Avg {Math.round(layer.avg)}ms</p>
                <p className="impact"><strong>User impact:</strong> {layer.impact}</p>
              </article>
            ))}
          </div>
        </div>
        </div>
      </section>

      {/* 3 */}
      <section className="run-report__block">
        <h2 className="run-report__h2"><span>3</span> Overall System Analysis</h2>
        <div className="run-report__two-col">
          <div className="run-report__panel">
            <h3 className="run-report__h3">Test configuration</h3>
            <dl className="run-report__kv">
              <div><dt>Test type</dt><dd>{String(runMeta?.mode ?? 'static')} (UEM)</dd></div>
              <div><dt>Browser</dt><dd>{String(cfg.browserType ?? 'chrome')}{cfg.headlessMode ? ' (headless)' : ''}</dd></div>
              <div><dt>Duration</dt><dd>{runMeta?.testDurationSeconds ? `${runMeta.testDurationSeconds}s` : 'No limit / once-through'}</dd></div>
              <div><dt>Think time</dt><dd>{String(cfg.thinkTime ?? 0)}ms</dd></div>
              <div><dt>Threads</dt><dd>{String(runMeta?.multiThreading ?? cfg.multiThreading ?? 1)} concurrent</dd></div>
              <div><dt>Source</dt><dd>{String(runMeta?.scriptId || (runMeta?.crawlRunId ? `crawl_${runMeta.crawlRunId}.csv` : 'static suite'))}</dd></div>
            </dl>
          </div>
          <div className="run-report__panel">
            <h3 className="run-report__h3">Run outcome</h3>
            <dl className="run-report__kv">
              <div><dt>Total URLs</dt><dd>{summary.total}</dd></div>
              <div><dt>Passed</dt><dd>{Math.round((summary.passRate / 100) * summary.total)}</dd></div>
              <div><dt>Failed</dt><dd>{summary.total - Math.round((summary.passRate / 100) * summary.total)}</dd></div>
              <div><dt>Avg response time</dt><dd>{Math.round(avg((r) => r.responseTime || 0))}ms</dd></div>
              <div><dt>Error rate</dt><dd>{(100 - summary.passRate).toFixed(1)}%</dd></div>
              <div><dt>Environment</dt><dd>{String(cfg.headlessMode === false ? 'Headed browser' : 'Automated / CI')}</dd></div>
            </dl>
          </div>
        </div>
        <h3 className="run-report__h3">Score distribution across pages</h3>
        <div className="run-report__dist-bars">
          {[
            ['critical', 'Critical', bandCounts.critical],
            ['needs', 'Needs attention', bandCounts.needs],
            ['good', 'Good', bandCounts.good],
            ['excellent', 'Excellent', bandCounts.excellent],
          ].map(([key, label, count]) => (
            <div key={key as string} className="run-report__dist-row">
              <span className="lbl">{label}</span>
              <div className="bar"><div style={{ width: `${summary.total ? ((count as number) / summary.total) * 100 : 0}%`, background: bandBarColor(key as 'critical' | 'needs' | 'good' | 'excellent') }} /></div>
              <span className="cnt">{count as number}</span>
            </div>
          ))}
        </div>
        {scoreChartData.length > 0 && (
          <div className="run-report__chart-card" style={{ marginTop: 12 }}>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={scoreChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#0F172A' }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#475569' }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v) => [`${v}`, 'Score']} />
                <Bar dataKey="score" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                  {scoreChartData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* 4 */}
      <section className="run-report__block">
        <h2 className="run-report__h2"><span>4</span> User Experience Behavior Analysis (Lighthouse)</h2>
        <p className="run-report__prose">Lighthouse category averages across {summary.total} audited pages{a11y == null && bp == null && seo == null ? ' (Performance available for this run; Accessibility / Best Practices / SEO populate on new runs with full-category audits).' : '.'}</p>
        <div className="run-report__cwv-grid">
          <div className={`run-report__cwv-card run-report__cwv-card--${scoreBandKey(avgScorePct)}`}><div className="num">{avgScorePct}</div><div className="lbl">Performance</div></div>
          <div className={`run-report__cwv-card ${a11y != null ? `run-report__cwv-card--${scoreBandKey(a11y)}` : ''}`}><div className="num">{a11y ?? '—'}</div><div className="lbl">Accessibility</div></div>
          <div className={`run-report__cwv-card ${bp != null ? `run-report__cwv-card--${scoreBandKey(bp)}` : ''}`}><div className="num">{bp ?? '—'}</div><div className="lbl">Best Practices</div></div>
          <div className={`run-report__cwv-card ${seo != null ? `run-report__cwv-card--${scoreBandKey(seo)}` : ''}`}><div className="num">{seo ?? '—'}</div><div className="lbl">SEO</div></div>
        </div>
        <h3 className="run-report__h3">Core Web Vitals</h3>
        <div className="run-report__table-wrap">
          <table className="run-report__simple">
            <thead><tr><th>Metric</th><th>Avg value</th><th>Threshold</th><th>Status</th></tr></thead>
            <tbody>
              {cwvRows.map((r) => (
                <tr key={r.metric}>
                  <td>{r.metric}</td>
                  <td><span className={vitalBadge(r.status)}>{r.display}</span></td>
                  <td>{r.threshold}</td>
                  <td><span className={vitalBadge(r.status)}>{lhStatusLabel(r.status)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="run-report__muted">* INP approximated from Total Blocking Time when field INP is not present in the run export.</p>

        <button type="button" className="run-report__collapse-btn" onClick={() => setUemOpen((v) => !v)}>
          {uemOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          UEM Summary for All Pages ({rows.length} · aggregate values)
        </button>
        {uemOpen && (
          <div className="run-report__table-wrap">
            <table className="run-report__simple run-report__simple--fit">
              <thead>
                <tr>
                  <th>Page URL</th><th>Count</th><th>LCP</th><th>FCP</th><th>INP*</th><th>CLS</th><th>TBT</th><th>Speed Index</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const pageStatus = r.aggregateStatus;
                  return (
                    <tr key={r.pageUrl}>
                      <td title={r.pageUrl} className="run-report__col-url">{pagePath(r.pageUrl)}</td>
                      <td>{r.hits}</td>
                      <td><span className={vitalBadge(lcpStatus(r.lcp))}>{fmtMs(r.lcp)}</span></td>
                      <td><span className={vitalBadge(fcpStatus(r.fcp))}>{fmtMs(r.fcp)}</span></td>
                      <td><span className={vitalBadge(inpStatus(r.tbt))}>{fmtMs(r.tbt)}</span></td>
                      <td><span className={vitalBadge(clsStatus(r.cls))}>{r.cls.toFixed(3)}</span></td>
                      <td><span className={vitalBadge(tbtStatus(r.tbt))}>{fmtMs(r.tbt)}</span></td>
                      <td><span className={vitalBadge(siStatus(r.speedIndex))}>{fmtMs(r.speedIndex)}</span></td>
                      <td><span className={vitalBadge(pageStatus)}>{lhStatusLabel(pageStatus)}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 5 */}
      <section className="run-report__block">
        <h2 className="run-report__h2"><span>5</span> Navigation Timing Analysis (Network, Server &amp; Browser)</h2>
        <p className="run-report__prose">Aggregate navigation timing across {rows.length} unique pages ({totalHits} hits). Average page load: <strong>{(aggAvgPageLoad / 1000).toFixed(1)}s</strong>. Dominant layer: <strong>{exec.layers.dominant}</strong>.</p>
        <div className="run-report__phase-grid">
          <div className={`run-report__layer-tile run-report__layer-tile--${layerStatus(avgNetwork, 'network')}`}><div className="num">{formatMs(avgNetwork)}</div><div className="lbl">Network</div><div className="sub">Redirects, DNS, connection &amp; content download · {lhStatusLabel(layerStatus(avgNetwork, 'network'))}</div></div>
          <div className={`run-report__layer-tile run-report__layer-tile--${layerStatus(avgServer, 'server')}`}><div className="num">{formatMs(avgServer)}</div><div className="lbl">Server</div><div className="sub">Request → first byte (TTFB {formatMs(avgTtfb)}) · {lhStatusLabel(layerStatus(avgServer, 'server'))}</div></div>
          <div className={`run-report__layer-tile run-report__layer-tile--${layerStatus(avgBrowser, 'browser')}`}><div className="num">{formatMs(avgBrowser)}</div><div className="lbl">Browser</div><div className="sub">DOM processing &amp; load event · {lhStatusLabel(layerStatus(avgBrowser, 'browser'))}</div></div>
        </div>
        <h3 className="run-report__h3">Timing breakdown by phase</h3>
        <div className="run-report__table-wrap">
          <table className="run-report__simple">
            <thead><tr><th>Phase</th><th>Category</th><th>Avg time</th><th>Share</th></tr></thead>
            <tbody>
              {phaseRows.map((p) => (
                <tr key={p.phase}>
                  <td>{p.phase}</td>
                  <td>{p.category}</td>
                  <td>{p.category === 'Network' && /DNS|Connection/.test(p.phase) ? <ConnTime ms={p.avg} /> : formatMs(p.avg)}</td>
                  <td>{Math.round((p.avg / totalPhase) * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="run-report__collapse-btn" onClick={() => setNavOpen((v) => !v)}>
          {navOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          Navigation summary by pages ({rows.length} · aggregate values)
        </button>
        {navOpen && (
          <div className="run-report__table-wrap">
            <table className="run-report__simple run-report__simple--fit">
              <thead>
                <tr>
                  <th>Page URL</th><th>Count</th><th>DNS Lookup</th><th>Initial Connection</th><th>TTFB</th><th>Content Downloaded</th><th>DOM Processing</th><th>Load Event</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const nav = navBreakdown(r);
                  if (!nav) {
                    return (
                      <tr key={`nav-${r.pageUrl}`}>
                        <td title={r.pageUrl} className="run-report__col-url">{pagePath(r.pageUrl)}</td>
                        <td>{r.hits}</td>
                        <td colSpan={6} className="run-report__muted">No navigation timing captured for this page</td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={`nav-${r.pageUrl}`}>
                      <td title={r.pageUrl} className="run-report__col-url">{pagePath(r.pageUrl)}</td>
                      <td>{r.hits}</td>
                      <td><ConnTime ms={nav.dns} /></td>
                      <td><ConnTime ms={nav.connection} /></td>
                      <td><span className={vitalBadge(ttfbStatus(nav.ttfb))}>{formatMs(nav.ttfb)}</span></td>
                      <td>{formatMs(nav.download)}</td>
                      <td>{formatMs(nav.domProcessing)}</td>
                      <td>{formatMs(nav.loadEvent)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="run-report__muted" style={{ marginTop: 8 }}>
              Phases from the browser's Navigation Timing (TTFB = responseStart − navigationStart, rated against web.dev: ≤ 800 ms good, ≤ 1.8 s needs improvement).
              DNS and connection show “reused” when the browser kept an open connection to the same host (0 ms). Network + Server + Browser add up to the page load.
            </p>
          </div>
        )}
      </section>

      {/* 6 */}
      <section className="run-report__block">
        <h2 className="run-report__h2"><span>6</span> Issues, Impact and Recommendations</h2>
        <div className="run-report__table-wrap">
          <table className="run-report__simple run-report__issues-table">
            <thead>
              <tr>
                <th>Severity</th><th>Issue</th><th>Examples</th><th>Description</th><th>Impact</th><th>Recommendation</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue) => (
                <tr key={issue.issue}>
                  <td><span className={`run-report__sev run-report__sev--${issue.severity.startsWith('Critical') ? 'critical' : issue.severity.startsWith('Needs') ? 'needs' : 'watch'}`}>{issue.severity}</span></td>
                  <td>{issue.issue}</td>
                  <td>{issue.examples}</td>
                  <td>{issue.description}</td>
                  <td>{issue.impact}</td>
                  <td>{issue.recommendation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 7 */}
      <section className="run-report__block">
        <h2 className="run-report__h2"><span>7</span> Optimisation Approach</h2>
        <p className="run-report__prose">Phased remediation for the highest-impact issues on {host} — resources, pages impacted, and projected before/after impact.</p>
        {phases.map((p) => (
          <article key={p.phase} className="run-report__phase-card">
            <header>
              <h3>{p.phase}. {p.title}</h3>
              <span className={`run-report__sev run-report__sev--${p.severity.startsWith('Critical') ? 'critical' : 'needs'}`}>{p.severity}</span>
            </header>
            <div className="run-report__phase-grid2">
              <div><h4>Resources</h4><pre>{p.resources}</pre></div>
              <div><h4>Pages impacted</h4><p>{p.pagesImpacted}</p></div>
            </div>
            <h4>What to fix</h4>
            <p>{p.whatToFix}</p>
            <h4>How to fix</h4>
            <ol>{p.howToFix.map((step) => <li key={step}>{step.replace(/^\d+\.\s*/, '')}</li>)}</ol>
            <h4>Impact of fixing — before / after</h4>
            <div className="run-report__before-after">
              {p.impact.map((m) => (
                <div key={m.metric}>
                  <div className="m">{m.metric}</div>
                  <div className="ba"><span className="before">{m.before}</span><span className="after">{m.after}</span></div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </section>

      {/* 8 */}
      <section className="run-report__block">
        <h2 className="run-report__h2"><span>8</span> Final Conclusion &amp; Next Steps</h2>
        <p className="run-report__prose">
          Overall, {host} is classified as <strong>{overall.label}</strong> with an average score of {avgScorePct}/100
          (p75={overall.p75}, p90={overall.p90}).
          {llmAnalysis?.justification?.summary ? ` ${llmAnalysis.justification.summary}` : ` Addressing the phased fixes in Section 6 is the fastest path to lift more pages into the Good (90–100) band.`}
        </p>
        <h3 className="run-report__h3">Recommended next steps</h3>
        <ol className="run-report__next-steps">
          {phases.map((p) => (
            <li key={`ns-${p.phase}`}>Ship remediation for “{p.title}” across {p.pagesImpacted}.</li>
          ))}
          <li>Re-run this suite after each fix batch to confirm projected before/after impact.</li>
          <li>Schedule recurring weekly runs to catch regressions before they reach production.</li>
        </ol>

        <div className={`run-report__golive run-report__golive--${goLive.key}`} style={{ marginTop: 20 }}>
          <div className="run-report__golive-head">
            <div>
              <div className="run-report__golive-kicker">Go-live assessment · {goLive.source}</div>
              <h2 className="run-report__golive-title">{goLive.label}</h2>
              <p className="run-report__golive-exec">{goLive.summary}</p>
            </div>
            <div className="run-report__golive-confidence">
              <div className="run-report__golive-confidence-num">{goLive.metric}</div>
              <div className="run-report__golive-confidence-lbl">{goLive.metricLabel}</div>
            </div>
          </div>
        </div>
      </section>

      <footer className="run-report__footer">
        Generated {generatedAt} by UI Performance Bot · Run #{runId}
        {meta?.analyzer ? ` · Analyzer: ${meta.analyzer}` : ''}
        {' · Thresholds per web.dev / Lighthouse Core Web Vitals'}
      </footer>
    </div>
  );
}
