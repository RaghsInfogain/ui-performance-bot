import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Download, ArrowLeft, RefreshCw, ExternalLink, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../services/api';
import type { RunReportAnalysis, RunReportMeta, GoLiveAnalysis } from '../types';
import type { ReportPageRow } from '../utils/reportDesign';
import {
  clsStatus,
  computeOverallSystemStatus,
  fcpStatus,
  fmtMs,
  hostFromRows,
  inpStatus,
  lcpStatus,
  mergeReportRows,
  pagePath,
  scoreBandKey,
  scoreBandLabel,
  scoreBarColor,
  bandBarColor,
  siStatus,
  tbtStatus,
  ttfbStatus,
  vitalBadge,
  vitalLabel,
} from '../utils/reportDesign';
import '../styles/runReport.css';

function buildIssues(rows: ReportPageRow[]) {
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

  const slowTtfb = rows.filter((r) => ttfbStatus(r.serverProcessingTime || r.responseTime || 0) !== 'good');
  if (slowTtfb.length) {
    issues.push({
      severity: 'Needs attn.',
      issue: 'Elevated Time to First Byte',
      examples: slowTtfb.slice(0, 3).map((r) => pagePath(r.pageUrl)).join(', '),
      description: `${slowTtfb.length} page(s) wait too long for the first byte — origin latency, missing CDN, or uncached HTML.`,
      impact: `Server/response time averages ${Math.round(slowTtfb.reduce((s, r) => s + (r.serverProcessingTime || r.responseTime || 0), 0) / slowTtfb.length)}ms on affected pages.`,
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

function buildOptPhases(rows: ReportPageRow[], host: string, issues: ReturnType<typeof buildIssues>) {
  return issues.filter((i) => i.severity !== 'Watch').slice(0, 3).map((issue, idx) => {
    const related = rows.filter((r) =>
      issue.issue.includes('LCP') ? lcpStatus(r.lcp) !== 'good'
        : issue.issue.includes('Blocking') ? tbtStatus(r.tbt) !== 'good'
          : issue.issue.includes('Layout') ? clsStatus(r.cls) !== 'good'
            : ttfbStatus(r.serverProcessingTime || r.responseTime || 0) !== 'good',
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

export default function RunReport() {
  const { runId } = useParams<{ runId: string }>();
  const [rows, setRows] = useState<ReportPageRow[]>([]);
  const [analysis, setAnalysis] = useState<RunReportAnalysis | null>(null);
  const [llmAnalysis, setLlmAnalysis] = useState<GoLiveAnalysis | null>(null);
  const [meta, setMeta] = useState<RunReportMeta | null>(null);
  const [runMeta, setRunMeta] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uemOpen, setUemOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  const load = () => {
    if (!runId) {
      setLoading(false);
      setError('Invalid run ID');
      return;
    }
    setLoading(true);
    setError('');
    Promise.all([
      api.getRunReport(runId),
      api.getRun(runId).catch(() => null),
    ])
      .then(([r, run]) => {
        setRows(mergeReportRows(r.results ?? [], r.pages ?? []));
        setAnalysis(r.analysis ?? null);
        setLlmAnalysis(r.llmAnalysis ?? null);
        setMeta(r.meta ?? null);
        setRunMeta(run as unknown as Record<string, unknown> | null);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Failed to load report');
        setAnalysis(null);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [runId]);

  if (loading) {
    return <div className="run-report"><p style={{ color: 'var(--rp-ink-mid)' }}>Generating consolidated report for run {runId}…</p></div>;
  }
  if (error) {
    return (
      <div className="run-report">
        <div style={{ background: '#FAECE7', color: '#993C1D', padding: 16, borderRadius: 8, marginBottom: 16 }}>{error}</div>
        <button onClick={load} className="btn-primary"><RefreshCw className="h-4 w-4" /> Retry</button>
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
  const avgScorePct = summary.avgScore;
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

  const avg = (fn: (r: ReportPageRow) => number) =>
    rows.length ? rows.reduce((s, r) => s + fn(r), 0) / rows.length : 0;
  const avgDns = Math.round(avg((r) => r.dnsLookupTime || 0));
  const avgConn = Math.round(avg((r) => r.connectionTime || 0));
  const avgTtfb = Math.round(avg((r) => r.serverProcessingTime || r.responseTime || 0));
  const avgDownload = Math.round(avg((r) => Math.max(0, (r.networkTime || 0) - (r.dnsLookupTime || 0) - (r.connectionTime || 0))));
  const avgDom = Math.round(avg((r) => r.domInteractionTime || r.domCompleteTime || 0));
  const avgLoadEvt = Math.round(avg((r) => Math.max(0, (r.pageLoadTime || 0) - (r.domCompleteTime || 0))));
  const totalPhase = Math.max(1, avgDns + avgConn + avgTtfb + avgDownload + avgDom + avgLoadEvt);
  const phaseRows = [
    { phase: 'DNS Lookup', category: 'Network', avg: avgDns },
    { phase: 'Initial Connection / SSL', category: 'Network', avg: avgConn },
    { phase: 'Time to First Byte', category: 'Server', avg: avgTtfb },
    { phase: 'Content Download', category: 'Network', avg: avgDownload },
    { phase: 'DOM Processing', category: 'Browser', avg: avgDom },
    { phase: 'Load Event', category: 'Browser', avg: avgLoadEvt },
  ];

  const catAvg = (key: 'accessibilityScore' | 'bestPracticesScore' | 'seoScore') => {
    const vals = rows.map((r) => Number(r[key] || 0)).filter((v) => v > 0);
    if (!vals.length) return null;
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100);
  };
  const a11y = catAvg('accessibilityScore');
  const bp = catAvg('bestPracticesScore');
  const seo = catAvg('seoScore');

  const avgNetwork = Math.round(avg((r) => r.networkTime || 0));
  const avgServer = Math.round(avg((r) => r.serverProcessingTime || 0));
  const avgBrowser = Math.round(avg((r) => r.browserTime || 0));
  const generatedAt = rows[0]?.timestamp
    ? new Date(rows[0].timestamp).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
    : new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

  const cwvRows = [
    { metric: 'Largest Contentful Paint (LCP)', avg: summary.avgLcp, threshold: '2.5s', status: lcpStatus(summary.avgLcp), display: `${(summary.avgLcp / 1000).toFixed(1)}s` },
    { metric: 'Interaction to Next Paint (INP)*', avg: summary.avgTbt, threshold: '200ms', status: inpStatus(summary.avgTbt), display: `${Math.round(summary.avgTbt)}ms` },
    { metric: 'Cumulative Layout Shift (CLS)', avg: summary.avgCls, threshold: '0.1', status: clsStatus(summary.avgCls), display: summary.avgCls.toFixed(2) },
    { metric: 'First Contentful Paint (FCP)', avg: summary.avgFcp, threshold: '1.8s', status: fcpStatus(summary.avgFcp), display: `${(summary.avgFcp / 1000).toFixed(1)}s` },
    { metric: 'Total Blocking Time (TBT)', avg: summary.avgTbt, threshold: '200ms', status: tbtStatus(summary.avgTbt), display: `${Math.round(summary.avgTbt)}ms` },
    { metric: 'Speed Index', avg: avg((r) => r.speedIndex || 0), threshold: '3.4s', status: siStatus(avg((r) => r.speedIndex || 0)), display: `${(avg((r) => r.speedIndex || 0) / 1000).toFixed(1)}s` },
  ];

  const execNarrative = [
    `This report summarizes UI performance testing across ${summary.total} pages of ${host}, captured in run #${runId}.`,
    `Testing used the static / UEM engine${runMeta?.multiThreading ? ` with ${runMeta.multiThreading} concurrent browser thread(s)` : ''}.`,
    `The site’s overall percentile status is ${overall.label}: ${overall.justification}`,
    `Average performance score is ${avgScorePct}/100 (${scoreBandLabel(avgScorePct)} band), with pass rate ${summary.passRate}% and average navigation page load ${(summary.avgPageLoad / 1000).toFixed(1)}s.`,
    criticalIssueCount
      ? `Primary drivers are concentrated in ${criticalIssueCount} critical issue theme(s) — see Sections 5–6 for impact and remediation sequenced by effort vs payoff.`
      : 'No critical CWV themes dominated this run; continue monitoring for regressions.',
    llmAnalysis?.executiveSummary ? llmAnalysis.executiveSummary : '',
  ].filter(Boolean).join(' ');

  const handleExport = async () => {
    if (!runId) return;
    const blob = await api.exportRunCsv(runId, 'static');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Static_Run_Report_RunID_${runId}.csv`;
    a.click();
  };

  return (
    <div className="run-report">
      <div className="run-report__toolbar">
        <button onClick={load} className="btn-secondary text-xs"><RefreshCw className="h-3 w-3" /> Refresh</button>
        <Link to={`/app/runs/${runId}`} className="btn-secondary text-xs"><ArrowLeft className="h-3 w-3" /> Run Detail</Link>
        <a href={api.getRunReportHtmlUrl(runId!)} target="_blank" rel="noreferrer" className="btn-secondary text-xs">
          <ExternalLink className="h-3 w-3" /> HTML Export
        </a>
        <button onClick={handleExport} className="btn-primary text-xs"><Download className="h-3 w-3" /> CSV</button>
      </div>

      <header className="run-report__cover">
        <div className="run-report__cover-kicker">UI Performance Bot</div>
        <h1 className="run-report__cover-title">Website Performance Report</h1>
        <div className="run-report__cover-meta">
          <div><span>Client / host</span><strong>{host}</strong></div>
          <div><span>Website tested</span><strong>{host}</strong></div>
          <div><span>Run ID</span><strong>#{runId}</strong></div>
          <div><span>Prepared by</span><strong>UI Performance Bot · Automated Test Engine</strong></div>
          <div><span>Generated</span><strong>{generatedAt}</strong></div>
        </div>

        <div className={`run-report__system-status run-report__system-status--${overall.status}`}>
          <div className="run-report__system-status-label">{overall.label}</div>
          <div className="run-report__system-status-meta">
            p75 score {overall.p75} · p90 score {overall.p90} · {Math.round(overall.goodBandPct)}% pages in Good (90–100)
          </div>
          <p className="run-report__system-status-why"><strong>Justification:</strong> {overall.justification}</p>
        </div>
      </header>

      {/* 1 */}
      <section className="run-report__block">
        <h2 className="run-report__h2"><span>1</span> Executive Summary &amp; Status Categorisation</h2>
        <p className="run-report__prose">{execNarrative}</p>
        <div className="run-report__band-grid">
          <div className="run-report__band-card run-report__band-card--critical"><div className="lbl">Critical 0–49</div><div className="num">{bandCounts.critical}</div><div className="sub">pages · {summary.total ? Math.round((bandCounts.critical / summary.total) * 100) : 0}%</div></div>
          <div className="run-report__band-card run-report__band-card--needs"><div className="lbl">Needs attention 50–74</div><div className="num">{bandCounts.needs}</div><div className="sub">pages · {summary.total ? Math.round((bandCounts.needs / summary.total) * 100) : 0}%</div></div>
          <div className="run-report__band-card run-report__band-card--good"><div className="lbl">Good 75–89</div><div className="num">{bandCounts.good}</div><div className="sub">pages · {summary.total ? Math.round((bandCounts.good / summary.total) * 100) : 0}%</div></div>
          <div className="run-report__band-card run-report__band-card--excellent"><div className="lbl">Excellent 90–100</div><div className="num">{bandCounts.excellent}</div><div className="sub">pages · {summary.total ? Math.round((bandCounts.excellent / summary.total) * 100) : 0}%</div></div>
        </div>
        <div className="run-report__exec-kpis">
          <div className={`run-report__kpi run-report__kpi--${scoreBandKey(avgScorePct)}`}><div className="lbl">Overall score</div><div className="num">{avgScorePct}/100</div></div>
          <div className="run-report__kpi"><div className="lbl">Pages tested</div><div className="num">{summary.total}</div></div>
          <div className={`run-report__kpi ${criticalIssueCount ? 'run-report__kpi--critical' : 'run-report__kpi--excellent'}`}><div className="lbl">Critical issues</div><div className="num">{criticalIssueCount}</div></div>
          <div className={`run-report__kpi ${summary.avgPageLoad > 4000 ? 'run-report__kpi--critical' : summary.avgPageLoad > 2500 ? 'run-report__kpi--needs' : 'run-report__kpi--excellent'}`}><div className="lbl">Avg load time</div><div className="num">{(summary.avgPageLoad / 1000).toFixed(1)}s</div></div>
        </div>
      </section>

      {/* 2 */}
      <section className="run-report__block">
        <h2 className="run-report__h2"><span>2</span> Overall System Analysis</h2>
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
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#1B1C1E' }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#5B5D63' }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v) => [`${v}`, 'Score']} />
                <Bar dataKey="score" radius={[3, 3, 0, 0]}>
                  {scoreChartData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* 3 */}
      <section className="run-report__block">
        <h2 className="run-report__h2"><span>3</span> User Experience Behavior Analysis (Lighthouse)</h2>
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
                  <td><span className={vitalBadge(r.status)}>{vitalLabel(r.status)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="run-report__muted">* INP approximated from Total Blocking Time when field INP is not present in the run export.</p>

        <button type="button" className="run-report__collapse-btn" onClick={() => setUemOpen((v) => !v)}>
          {uemOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          UEM Summary for All Pages ({rows.length})
        </button>
        {uemOpen && (
          <div className="run-report__table-wrap">
            <table className="run-report__simple run-report__simple--fit">
              <thead>
                <tr>
                  <th>Page URL</th><th>LCP</th><th>FCP</th><th>INP*</th><th>CLS</th><th>TBT</th><th>Speed Index</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const pageStatus = [lcpStatus(r.lcp), fcpStatus(r.fcp), tbtStatus(r.tbt), clsStatus(r.cls)]
                    .includes('poor') ? 'poor' : [lcpStatus(r.lcp), fcpStatus(r.fcp), tbtStatus(r.tbt), clsStatus(r.cls)].includes('warn') ? 'warn' : 'good';
                  return (
                    <tr key={r.pageUrl}>
                      <td title={r.pageUrl} className="run-report__col-url">{pagePath(r.pageUrl)}</td>
                      <td><span className={vitalBadge(lcpStatus(r.lcp))}>{fmtMs(r.lcp)}</span></td>
                      <td><span className={vitalBadge(fcpStatus(r.fcp))}>{fmtMs(r.fcp)}</span></td>
                      <td><span className={vitalBadge(inpStatus(r.tbt))}>{fmtMs(r.tbt)}</span></td>
                      <td><span className={vitalBadge(clsStatus(r.cls))}>{r.cls.toFixed(3)}</span></td>
                      <td><span className={vitalBadge(tbtStatus(r.tbt))}>{fmtMs(r.tbt)}</span></td>
                      <td><span className={vitalBadge(siStatus(r.speedIndex))}>{fmtMs(r.speedIndex)}</span></td>
                      <td><span className={vitalBadge(pageStatus)}>{vitalLabel(pageStatus)}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 4 */}
      <section className="run-report__block">
        <h2 className="run-report__h2"><span>4</span> Navigation Timing Analysis (Network, Server &amp; Browser)</h2>
        <p className="run-report__prose">Average navigation timing across all tested pages. Total average page load: <strong>{(summary.avgPageLoad / 1000).toFixed(1)}s</strong>.</p>
        <div className="run-report__phase-grid">
          <div><div className="num">{avgNetwork}ms</div><div className="lbl">Network</div><div className="sub">DNS, connection &amp; content download</div></div>
          <div><div className="num">{avgServer}ms</div><div className="lbl">Server</div><div className="sub">Time to first byte</div></div>
          <div><div className="num">{avgBrowser}ms</div><div className="lbl">Browser</div><div className="sub">DOM processing &amp; load event</div></div>
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
                  <td>{p.avg}ms</td>
                  <td>{Math.round((p.avg / totalPhase) * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="run-report__collapse-btn" onClick={() => setNavOpen((v) => !v)}>
          {navOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          Navigation summary by pages ({rows.length})
        </button>
        {navOpen && (
          <div className="run-report__table-wrap">
            <table className="run-report__simple run-report__simple--fit">
              <thead>
                <tr>
                  <th>Page URL</th><th>DNS Lookup</th><th>Initial Connection</th><th>TTFB</th><th>Content Downloaded</th><th>DOM Processing</th><th>Load Event</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const ttfb = r.serverProcessingTime || r.responseTime || 0;
                  const download = Math.max(0, (r.networkTime || 0) - (r.dnsLookupTime || 0) - (r.connectionTime || 0));
                  const loadEvt = Math.max(0, (r.pageLoadTime || 0) - (r.domCompleteTime || 0));
                  return (
                    <tr key={`nav-${r.pageUrl}`}>
                      <td title={r.pageUrl} className="run-report__col-url">{pagePath(r.pageUrl)}</td>
                      <td>{Math.round(r.dnsLookupTime || 0)}ms</td>
                      <td>{Math.round(r.connectionTime || 0)}ms</td>
                      <td><span className={vitalBadge(ttfbStatus(ttfb))}>{Math.round(ttfb)}ms</span></td>
                      <td>{Math.round(download)}ms</td>
                      <td>{Math.round(r.domInteractionTime || r.domCompleteTime || 0)}ms</td>
                      <td>{Math.round(loadEvt)}ms</td>
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
        <h2 className="run-report__h2"><span>5</span> Issues, Impact and Recommendations</h2>
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

      {/* 6 */}
      <section className="run-report__block">
        <h2 className="run-report__h2"><span>6</span> Optimisation Approach</h2>
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

      {/* 7 */}
      <section className="run-report__block">
        <h2 className="run-report__h2"><span>7</span> Final Conclusion &amp; Next Steps</h2>
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

        {llmAnalysis ? (
          <div className={`run-report__golive run-report__golive--${llmAnalysis.verdict.toLowerCase().replace(/_/g, '-')}`} style={{ marginTop: 20 }}>
            <div className="run-report__golive-head">
              <div>
                <div className="run-report__golive-kicker">Go-live assessment · {llmAnalysis.generatedBy}</div>
                <h2 className="run-report__golive-title">{llmAnalysis.verdictLabel}</h2>
                <p className="run-report__golive-exec">{llmAnalysis.executiveSummary}</p>
              </div>
              <div className="run-report__golive-confidence">
                <div className="run-report__golive-confidence-num">{Math.round(llmAnalysis.confidence * 100)}%</div>
                <div className="run-report__golive-confidence-lbl">confidence</div>
              </div>
            </div>
          </div>
        ) : (
          <div className={`run-report__golive run-report__golive--${overall.status === 'healthy' ? 'go-live' : overall.status === 'critical' ? 'not-go-live' : 'conditional'}`} style={{ marginTop: 20 }}>
            <div className="run-report__golive-head">
              <div>
                <div className="run-report__golive-kicker">Go-live assessment · Percentile model</div>
                <h2 className="run-report__golive-title">
                  {overall.status === 'healthy' ? 'Ready to go live' : overall.status === 'critical' ? 'Not ready to go live' : 'Conditional go-live'}
                </h2>
                <p className="run-report__golive-exec">{overall.justification}</p>
              </div>
              <div className="run-report__golive-confidence">
                <div className="run-report__golive-confidence-num">{overall.p75}</div>
                <div className="run-report__golive-confidence-lbl">p75 score</div>
              </div>
            </div>
          </div>
        )}
      </section>

      <footer className="run-report__footer">
        Generated {generatedAt} by UI Performance Bot · Run #{runId}
        {meta?.analyzer ? ` · Analyzer: ${meta.analyzer}` : ''}
        {' · Thresholds per web.dev / Lighthouse Core Web Vitals'}
      </footer>
    </div>
  );
}
