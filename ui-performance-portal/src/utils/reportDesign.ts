import type { RunReportPage, StaticResultRow } from '../types';

export type VitalStatus = 'good' | 'warn' | 'poor';

export interface PracticalMetric {
  value: number;
  formula: string;
  purpose: string;
}

export interface WaterfallStep {
  label: string;
  start: number;
  duration: number;
  formula?: string;
  purpose?: string;
  estimated?: boolean;
}

export interface ReportPageRow extends StaticResultRow {
  opportunities?: RunReportPage['opportunities'];
  lighthouseFile?: string;
  navTimingFile?: string;
  practicalMetrics?: Record<string, PracticalMetric> | null;
  practicalWaterfall?: WaterfallStep[];
}

export function scoreBandLabel(scorePct: number): string {
  if (scorePct >= 90) return 'Excellent';
  if (scorePct >= 75) return 'Good';
  if (scorePct >= 50) return 'Needs attention';
  return 'Critical';
}

export function scoreBandKey(scorePct: number): 'excellent' | 'good' | 'needs' | 'critical' {
  if (scorePct >= 90) return 'excellent';
  if (scorePct >= 75) return 'good';
  if (scorePct >= 50) return 'needs';
  return 'critical';
}

export function fcpStatus(ms: number): VitalStatus {
  if (ms <= 1800) return 'good';
  if (ms <= 3000) return 'warn';
  return 'poor';
}

export function siStatus(ms: number): VitalStatus {
  if (ms <= 3400) return 'good';
  if (ms <= 5800) return 'warn';
  return 'poor';
}

export function inpStatus(ms: number): VitalStatus {
  if (ms <= 200) return 'good';
  if (ms <= 500) return 'warn';
  return 'poor';
}

export function ttfbStatus(ms: number): VitalStatus {
  if (ms <= 800) return 'good';
  if (ms <= 1800) return 'warn';
  return 'poor';
}

/** Text-only tone (legacy). Prefer vitalBadge for PDF-aligned pills. */
export function vitalTone(s: VitalStatus): string {
  if (s === 'good') return 'text-[#065f46]';
  if (s === 'warn') return 'text-[#92400e]';
  return 'text-[#991b1b]';
}

/** PDF Report Design status pills: Good=green, Needs attention=amber, Critical=red. */
export function vitalBadge(s: VitalStatus): string {
  if (s === 'good') return 'rp-badge rp-badge--good';
  if (s === 'warn') return 'rp-badge rp-badge--warn';
  return 'rp-badge rp-badge--poor';
}

export function vitalLabel(s: VitalStatus): string {
  if (s === 'good') return 'Good';
  if (s === 'warn') return 'Needs attention';
  return 'Critical';
}

export function percentile(sortedAsc: number[], p: number): number {
  if (!sortedAsc.length) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1));
  return sortedAsc[idx];
}

/** Site-wide status using percentile + share of pages in the Lighthouse Good (90–100) band. */
export function computeOverallSystemStatus(rows: Array<{ performanceScore: number; lcp: number; serverProcessingTime?: number; responseTime?: number }>) {
  const scores = rows.map((r) => Math.round((r.performanceScore || 0) * 100)).filter((s) => s > 0).sort((a, b) => a - b);
  const total = scores.length || rows.length || 1;
  const goodBandCount = scores.filter((s) => s >= 90).length;
  const goodBandPct = (goodBandCount / total) * 100;
  const p75 = percentile(scores, 75);
  const p90 = percentile(scores, 90);
  const lcpGoodPct = rows.length
    ? (rows.filter((r) => lcpStatus(r.lcp || 0) === 'good').length / rows.length) * 100
    : 0;
  const ttfbGoodPct = rows.length
    ? (rows.filter((r) => ttfbStatus(r.serverProcessingTime || r.responseTime || 0) === 'good').length / rows.length) * 100
    : 0;

  let status: 'healthy' | 'degraded' | 'critical' = 'degraded';
  let label = 'Degraded / Warning';
  let justification = '';

  if (p75 < 50 || p90 < 50) {
    status = 'critical';
    label = 'Critical';
    justification = `p75 score is ${p75} and p90 is ${p90} (below 50), indicating system-wide performance is severely compromised across a large share of audited pages.`;
  } else if (goodBandPct >= 75 && goodBandPct <= 100 && lcpGoodPct >= 70 && ttfbGoodPct >= 70) {
    status = 'healthy';
    label = 'Healthy';
    justification = `${Math.round(goodBandPct)}% of audited pages sit in the Good (90–100) score band, and critical Navigation Timing metrics (LCP/TTFB) meet fast thresholds on most pages (LCP good: ${Math.round(lcpGoodPct)}%, TTFB good: ${Math.round(ttfbGoodPct)}%).`;
  } else {
    status = 'degraded';
    label = 'Degraded / Warning';
    justification = `p75 performance score is ${p75} (Needs Improvement range). Only ${Math.round(goodBandPct)}% of pages hit the Good (90–100) band, so roughly a quarter or more of pages/traffic experiences slowdowns.`;
  }

  return { status, label, justification, goodBandPct, p75, p90, lcpGoodPct, ttfbGoodPct };
}

export function scoreClass(scorePct: number): VitalStatus {
  if (scorePct >= 90) return 'good';
  if (scorePct >= 50) return 'warn';
  return 'poor';
}

export function lcpStatus(ms: number): VitalStatus {
  if (ms <= 2500) return 'good';
  if (ms <= 4000) return 'warn';
  return 'poor';
}

export function tbtStatus(ms: number): VitalStatus {
  if (ms <= 200) return 'good';
  if (ms <= 500) return 'warn';
  return 'poor';
}

export function clsStatus(cls: number): VitalStatus {
  if (cls <= 0.1) return 'good';
  if (cls <= 0.25) return 'warn';
  return 'poor';
}

export function statusLabel(s: VitalStatus): string {
  if (s === 'good') return 'good';
  if (s === 'warn') return 'needs work';
  return 'poor';
}

export function failsCoreWebVitals(row: StaticResultRow): boolean {
  return lcpStatus(row.lcp) === 'poor' || clsStatus(row.cls) === 'poor' || tbtStatus(row.tbt) === 'poor';
}

export function pagePath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search || '/';
  } catch {
    return url;
  }
}

export function hostFromRows(rows: StaticResultRow[]): string {
  if (!rows.length) return 'Performance report';
  try {
    return new URL(rows[0].pageUrl).hostname;
  } catch {
    return rows[0].hostname || 'Performance report';
  }
}

function dur(start: number, end: number): number {
  if (start <= 0 || end <= 0) return 0;
  return Math.max(0, Math.round(end - start));
}

/** Use API-provided waterfall or build CSV fallback. */
export function getWaterfallSteps(row: ReportPageRow): WaterfallStep[] {
  if (row.practicalWaterfall?.length) return row.practicalWaterfall;

  const dns = row.dnsLookupTime || 0;
  const tcp = row.connectionTime || 0;
  const download = row.serverProcessingTime || 0;
  const domBuild = row.domInteractionTime || 0;
  const domComplete = Math.max(0, (row.domCompleteTime || 0) - domBuild);
  const pageLoad = row.pageLoadTime || 0;

  let start = 0;
  const steps: WaterfallStep[] = [];
  const add = (label: string, duration: number, formula: string, purpose: string) => {
    if (duration <= 0) return;
    steps.push({ label, start, duration, formula, purpose, estimated: true });
    start += duration;
  };

  add('DNS', dns, 'domainLookupEnd − domainLookupStart', 'DNS resolution (from CSV)');
  add('TCP', tcp, 'connectEnd − connectStart', 'TCP handshake (from CSV)');
  const serverWait = Math.max(0, (row.responseTime || 0) - download - tcp - dns);
  add('Server wait', serverWait, 'estimated', 'Request + server wait (estimated)');
  add('Document download', download, 'responseEnd − responseStart', 'Response body download');
  add('DOM build', domBuild, 'domInteractive − responseEnd', 'DOM construction (approx.)');
  add('DOM complete', domComplete, 'domComplete − domInteractive', 'Post-interactive DOM (approx.)');
  add('Load finish', Math.max(0, pageLoad - start), 'loadEventEnd − navigationStart', 'Remaining to full load');

  return steps;
}

export function mergeReportRows(
  results: StaticResultRow[],
  pages: RunReportPage[],
): ReportPageRow[] {
  const byUrl = new Map(pages.map((p) => [p.pageUrl, p]));
  return results.map((r) => {
    const extra = byUrl.get(r.pageUrl);
    return {
      ...r,
      opportunities: extra?.opportunities ?? (r as ReportPageRow).opportunities,
      lighthouseFile: extra?.lighthouseFile ?? (r as ReportPageRow).lighthouseFile,
      navTimingFile: extra?.navTimingFile,
      practicalMetrics: extra?.practicalMetrics ?? null,
      practicalWaterfall: extra?.practicalWaterfall,
      accessibilityScore: extra?.accessibilityScore ?? r.accessibilityScore ?? 0,
      bestPracticesScore: extra?.bestPracticesScore ?? r.bestPracticesScore ?? 0,
      seoScore: extra?.seoScore ?? r.seoScore ?? 0,
    };
  });
}

export const WATERFALL_COLORS = ['#85B7EB', '#378ADD', '#0C447C', '#97C459', '#639922', '#3B6D11', '#854F0B', '#993C1D'];

/** PDF band colors: Critical red · Needs amber · Good blue · Excellent green */
export function scoreBarColor(scorePct: number): string {
  if (scorePct >= 90) return '#059669';
  if (scorePct >= 75) return '#2563eb';
  if (scorePct >= 50) return '#d97706';
  return '#dc2626';
}

export function bandBarColor(band: 'critical' | 'needs' | 'good' | 'excellent'): string {
  if (band === 'excellent') return '#059669';
  if (band === 'good') return '#2563eb';
  if (band === 'needs') return '#d97706';
  return '#dc2626';
}

export const METRIC_LABELS: Record<string, string> = {
  dns: 'DNS',
  tcp: 'TCP',
  tls: 'TLS',
  ttfb: 'TTFB',
  serverWait: 'Server wait',
  documentFetch: 'Document fetch',
  domBuild: 'DOM build',
  scriptTime: 'Script load/exec',
  loadEvent: 'Load event',
  pageLoad: 'Page load',
};
export const PRACTICAL_METRIC_GROUPS = [
  {
    title: 'Network & server latency',
    keys: ['dns', 'tcp', 'tls', 'ttfb', 'serverWait'],
  },
  {
    title: 'Browser & parsing',
    keys: ['documentFetch', 'domBuild', 'scriptTime'],
  },
  {
    title: 'Page lifecycle',
    keys: ['loadEvent', 'pageLoad'],
  },
] as const;

/** All practical metric keys in table column order */
export const TABLE_NAV_COLUMNS = [
  'dns', 'tcp', 'tls', 'ttfb', 'serverWait', 'documentFetch', 'domBuild', 'scriptTime', 'loadEvent', 'pageLoad',
] as const;

/** Compact column labels for the main report table (full names in title tooltips). */
export const TABLE_METRIC_LABELS: Record<string, string> = {
  dns: 'DNS',
  tcp: 'TCP',
  tls: 'TLS',
  ttfb: 'TTFB',
  serverWait: 'Srv',
  documentFetch: 'Doc',
  domBuild: 'DOM',
  scriptTime: 'JS',
  loadEvent: 'Evt',
  pageLoad: 'Load',
};

export const TABLE_LH_COLUMNS = ['fcp', 'lcp', 'tbt', 'cls', 'speedIndex'] as const;

export function getPracticalMetric(row: ReportPageRow, key: string): number {
  const fromApi = row.practicalMetrics?.[key]?.value;
  if (fromApi != null && fromApi > 0) return fromApi;
  if (row.practicalMetrics?.[key]?.value === 0) return 0;

  switch (key) {
    case 'dns': return row.dnsLookupTime || 0;
    case 'tcp': return row.connectionTime || 0;
    case 'tls': return 0;
    case 'ttfb':
      return Math.max(0, (row.dnsLookupTime || 0) + (row.connectionTime || 0)
        + Math.max(0, (row.responseTime || 0) - (row.serverProcessingTime || 0) - (row.connectionTime || 0) - (row.dnsLookupTime || 0)));
    case 'serverWait':
      return Math.max(0, (row.responseTime || 0) - (row.serverProcessingTime || 0)
        - (row.connectionTime || 0) - (row.dnsLookupTime || 0));
    case 'documentFetch': return row.serverProcessingTime || 0;
    case 'domBuild': return row.domInteractionTime || 0;
    case 'scriptTime': return Math.max(0, (row.domCompleteTime || 0) - (row.domInteractionTime || 0));
    case 'loadEvent': return Math.max(0, (row.pageLoadTime || 0) - (row.domCompleteTime || 0));
    case 'pageLoad': return row.pageLoadTime || 0;
    default: return 0;
  }
}

export interface MetricAnomaly {
  severity: 'info' | 'warn';
  title: string;
  explanation: string;
}

export function detectAnomalies(row: ReportPageRow): MetricAnomaly[] {
  const anomalies: MetricAnomaly[] = [];
  const navLoad = getPracticalMetric(row, 'pageLoad') || row.pageLoadTime;
  const lcp = row.lcp;
  const fcp = row.fcp;
  const tbt = row.tbt;

  if (navLoad > 0 && lcp > navLoad * 1.4 && lcp - navLoad > 1500) {
    anomalies.push({
      severity: 'warn',
      title: 'LCP is much higher than Navigation page load',
      explanation: `Lighthouse reports LCP at ${(lcp / 1000).toFixed(1)}s, but Navigation Timing \`loadEventEnd\` is ${(navLoad / 1000).toFixed(1)}s. LCP tracks when the largest visible element (hero image, carousel, lazy block) actually paints. Navigation page load fires when the document and its declared subresources finish — not when late-rendered or lazy content appears. A large gap usually means images, web fonts, or JavaScript-driven content paint well after the load event.`,
    });
  }

  if (navLoad > 0 && fcp > navLoad * 1.2 && fcp - navLoad > 1000) {
    anomalies.push({
      severity: 'info',
      title: 'FCP exceeds Navigation load event',
      explanation: `First Contentful Paint (${(fcp / 1000).toFixed(1)}s) is later than the Navigation load time (${(navLoad / 1000).toFixed(1)}s). This can happen when Lighthouse measures paint timing under mobile throttling while Navigation Timing was captured in a separate, unthrottled browser pass — or when paint is delayed by render-blocking resources measured differently by each tool.`,
    });
  }

  if (tbt > 300 && navLoad < 4000) {
    anomalies.push({
      severity: 'info',
      title: 'High TBT with moderate Navigation load',
      explanation: `Total Blocking Time is ${tbt}ms (main-thread blocking) while Navigation page load is ${(navLoad / 1000).toFixed(1)}s. TBT accumulates long tasks after FCP during JavaScript execution. The page can reach \`loadEventEnd\` quickly while the main thread remains busy — hurting interactivity even when the load event has fired.`,
    });
  }

  if (!row.navTimingFile && !row.practicalMetrics) {
    anomalies.push({
      severity: 'info',
      title: 'Navigation metrics estimated from CSV',
      explanation: 'Precise milestone timings (TLS, script phase, fetchStart) require NavTiming*.json from a recent test run. Values prefixed with ~ in the table are derived from aggregated CSV columns.',
    });
  }

  return anomalies;
}

export const METRICS_GUIDE = {
  title: 'Understanding Lighthouse vs Navigation Timing',
  intro: 'This report combines two independent measurement systems. Large gaps between columns are expected — not a data error.',
  sections: [
    {
      heading: 'What Navigation Timing measures',
      body: 'The Navigation Timing API records the main HTML document lifecycle: DNS, TCP/TLS, TTFB, HTML download, DOM construction, script execution, and the window `load` event (`loadEventEnd − navigationStart`). It does not track when individual images paint, when fonts swap in, or when JavaScript inserts late content.',
    },
    {
      heading: 'What Lighthouse measures',
      body: 'Lighthouse is a lab audit that simulates mobile conditions (throttled CPU/network). FCP, LCP, TBT, CLS, and Speed Index reflect user-perceived rendering and interactivity — including lazy-loaded heroes, third-party widgets, and layout shifts. LCP in particular often occurs seconds after the Navigation `load` event on image-heavy sites.',
    },
    {
      heading: 'Why page load can look "fast" but LCP looks "slow"',
      body: 'If Navigation page load is ~7s but LCP is ~26s, the HTML document finished loading while the largest visible element (e.g. a full-width hero image) had not painted yet. The image may load lazily, depend on a web font, or be injected by JavaScript after initial parse. Trust LCP for perceived content speed; use Navigation Timing to diagnose network and server bottlenecks (DNS, TTFB, download).',
    },
    {
      heading: 'Why Lighthouse and Navigation use separate runs in this tool',
      body: 'Lighthouse executes via CLI (often with mobile CPU/network throttling). Navigation Timing is then captured in a separate Playwright browser navigation. Cache warmth, connection state, and throttling differ between passes — so values will not align exactly even for the same URL.',
    },
    {
      heading: 'How to read this report',
      body: 'Use Navigation columns (DNS → Page load) to fix server and network issues. Use Lighthouse columns (FCP, LCP, TBT, CLS) to fix rendering and UX. When a row shows a warning badge, expand it for a page-specific explanation.',
    },
  ],
};

export function fmtMs(ms: number, estimated?: boolean): string {
  if (ms <= 0) return '—';
  const prefix = estimated ? '~' : '';
  return ms >= 1000 ? `${prefix}${(ms / 1000).toFixed(1)}s` : `${prefix}${Math.round(ms)}ms`;
}

