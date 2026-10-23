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
  if (s === 'good') return 'text-[#047857]';
  if (s === 'warn') return 'text-[#b45309]';
  return 'text-[#b91c1c]';
}

/** PDF Report Design status pills: Good=green, Needs attention=amber, Critical=red. */
export function vitalBadge(s: VitalStatus): string {
  if (s === 'good') return 'rp-badge rp-badge--good';
  if (s === 'warn') return 'rp-badge rp-badge--warn';
  return 'rp-badge rp-badge--poor';
}

/** Neutral pill for values not measured yet (e.g. Lighthouse still running). */
export const NEUTRAL_BADGE = 'rp-badge rp-badge--neutral';

/**
 * Page rating as Lighthouse defines it: the performance score category
 * (90–100 Good, 50–89 Needs Improvement, 0–49 Poor). Without a score yet, fall back to the
 * worst rating among the metrics measured so far; a run that failed functionally is Failed.
 */
export function pageLighthouseStatus(row: {
  performanceScore?: number; fcp?: number; lcp?: number; cls?: number; tbt?: number; speedIndex?: number;
  passCount?: number; failCount?: number; testStatus?: string;
}): { status: VitalStatus | 'failed' | 'pending'; label: string; reason: string } {
  if (row.testStatus === 'FAIL' && !(row.passCount ?? 0)) {
    return { status: 'failed', label: 'Failed', reason: 'Every hit on this page failed functionally' };
  }
  const metrics: Array<[string, VitalStatus | null]> = [
    ['FCP', (row.fcp ?? 0) > 0 ? fcpStatus(row.fcp!) : null],
    ['LCP', (row.lcp ?? 0) > 0 ? lcpStatus(row.lcp!) : null],
    ['TBT', (row.tbt ?? 0) > 0 ? tbtStatus(row.tbt!) : null],
    ['CLS', (row.lcp ?? 0) > 0 ? clsStatus(row.cls ?? 0) : null],
    ['Speed Index', (row.speedIndex ?? 0) > 0 ? siStatus(row.speedIndex!) : null],
  ];
  const weak = metrics.filter(([, st]) => st && st !== 'good').map(([n, st]) => `${n} ${lhStatusLabel(st!)}`);
  const scorePct = Math.round((row.performanceScore ?? 0) * 100);
  if (scorePct > 0) {
    const status = scoreClass(scorePct);
    return {
      status,
      label: lhStatusLabel(status),
      reason: `Performance score ${scorePct} (Lighthouse: 90–100 Good · 50–89 Needs Improvement · 0–49 Poor)`
        + (weak.length ? ` — ${weak.join(', ')}` : ''),
    };
  }
  const measured = metrics.map(([, st]) => st).filter((st): st is VitalStatus => st !== null);
  if (!measured.length) return { status: 'pending', label: 'Measuring', reason: 'No Lighthouse metrics yet' };
  const status = worstStatus(...measured);
  return { status, label: lhStatusLabel(status), reason: `No performance score yet — worst metric rating${weak.length ? `: ${weak.join(', ')}` : ''}` };
}

/** Badge classes for any status, including Failed (red) and pending (neutral). */
export function statusBadge(status: VitalStatus | 'failed' | 'pending'): string {
  if (status === 'failed') return vitalBadge('poor');
  if (status === 'pending') return NEUTRAL_BADGE;
  return vitalBadge(status);
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

/** Navigation-timing fields a row may carry (engine CSV columns + optional browser capture). */
export interface NavTimingSource {
  pageLoadTime?: number;
  dnsLookupTime?: number;
  connectionTime?: number;
  serverProcessingTime?: number;
  responseTime?: number;
  browserTime?: number;
  domInteractionTime?: number;
  domCompleteTime?: number;
  practicalMetrics?: Record<string, PracticalMetric> | null;
}

/** One page's load split into phases, and into Network + Server + Browser (which sum to pageLoad). */
export interface NavBreakdown {
  dns: number;
  connection: number;
  /** Redirects and request queueing before the final document request. */
  redirectQueue: number;
  /** Request sent → first byte (server think time + round trip). */
  serverWait: number;
  /** First byte → last byte of the HTML document. */
  download: number;
  /** navigationStart → responseStart (standard TTFB). */
  ttfb: number;
  domProcessing: number;
  scriptTime: number;
  loadEvent: number;
  pageLoad: number;
  network: number;
  server: number;
  browser: number;
}

/**
 * Single definition of navigation timing used across the report and the Run page.
 * Engine CSV columns: networkTime = connectEnd − domainLookupStart (DNS + connect only),
 * serverProcessingTime = responseEnd − responseStart (the document DOWNLOAD),
 * responseTime = responseEnd − requestStart, browserTime = loadEventEnd − domLoading.
 * The browser capture (practicalMetrics) is preferred when present.
 */
export function navBreakdown(row: NavTimingSource): NavBreakdown | null {
  const n = (v: unknown) => Math.max(0, Number(v) || 0);
  const pm = row.practicalMetrics;
  const pv = (k: string) => n(pm?.[k]?.value);
  const download = n(row.serverProcessingTime);

  if (pm && pv('pageLoad') > 0) {
    const dns = pv('dns');
    const connection = pv('tcp') + pv('tls');
    const serverWait = pv('serverWait');
    const ttfb = pv('ttfb');
    const redirectQueue = Math.max(0, ttfb - dns - connection - serverWait);
    const domProcessing = pv('domBuild');
    const scriptTime = pv('scriptTime');
    const loadEvent = pv('loadEvent');
    const pageLoad = pv('pageLoad');
    const browser = domProcessing + scriptTime + loadEvent;
    const server = serverWait;
    return {
      dns, connection, redirectQueue, serverWait, download, ttfb, domProcessing, scriptTime, loadEvent, pageLoad,
      server, browser, network: Math.max(0, pageLoad - server - browser),
    };
  }

  const pageLoad = n(row.pageLoadTime);
  if (!pageLoad) return null;
  const dns = n(row.dnsLookupTime);
  const connection = n(row.connectionTime);
  const serverWait = Math.max(0, n(row.responseTime) - download);
  const browser = n(row.browserTime) || Math.max(0, pageLoad - n(row.responseTime) - dns - connection);
  const domProcessing = n(row.domInteractionTime);
  const scriptTime = Math.max(0, n(row.domCompleteTime) - domProcessing);
  const loadEvent = Math.max(0, browser - domProcessing - scriptTime);
  const redirectQueue = Math.max(0, pageLoad - browser - download - serverWait - dns - connection);
  return {
    dns, connection, redirectQueue, serverWait, download,
    ttfb: dns + connection + redirectQueue + serverWait,
    domProcessing, scriptTime, loadEvent, pageLoad,
    server: serverWait, browser, network: Math.max(0, pageLoad - serverWait - browser),
  };
}

/** Average a breakdown field over the rows that have navigation timing. */
export function avgNav(rows: NavTimingSource[], key: keyof NavBreakdown): number {
  const vals = rows.map((r) => navBreakdown(r)).filter((b): b is NavBreakdown => b !== null).map((b) => b[key]);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
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
    ? (rows.filter((r) => ttfbStatus(navBreakdown(r as NavTimingSource)?.ttfb ?? 0) === 'good').length / rows.length) * 100
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

/**
 * The website a run tested: the most common http(s) host among its pages. Rows such as
 * about:blank (blank pages recorded during a run) are ignored.
 */
export function siteFromRows(rows: Array<{ pageUrl?: string }>): { host: string; origin: string; client: string } | null {
  const counts = new Map<string, { n: number; origin: string }>();
  for (const r of rows) {
    try {
      const u = new URL(String(r.pageUrl || ''));
      if (!/^https?:$/.test(u.protocol) || !u.hostname) continue;
      const cur = counts.get(u.hostname) ?? { n: 0, origin: u.origin };
      cur.n += 1;
      counts.set(u.hostname, cur);
    } catch {
      /* not a URL */
    }
  }
  const best = [...counts.entries()].sort((a, b) => b[1].n - a[1].n)[0];
  if (!best) return null;
  const host = best[0];
  // Client = the organisation's domain (drop www. and similar sub-domains)
  const parts = host.split('.');
  const keep = parts.length > 2 && parts[parts.length - 2].length <= 3 ? 3 : 2;
  const client = /^\d+(\.\d+){3}$/.test(host) ? host : parts.slice(-keep).join('.');
  return { host, origin: best[1].origin, client };
}

export function hostFromRows(rows: StaticResultRow[]): string {
  return siteFromRows(rows)?.host ?? 'Performance report';
}

function dur(start: number, end: number): number {
  if (start <= 0 || end <= 0) return 0;
  return Math.max(0, Math.round(end - start));
}

/** Use API-provided waterfall or build CSV fallback. */
export function getWaterfallSteps(row: ReportPageRow): WaterfallStep[] {
  if (row.practicalWaterfall?.length) return row.practicalWaterfall;

  const nav = navBreakdown(row);
  if (!nav) return [];

  let start = 0;
  const steps: WaterfallStep[] = [];
  const add = (label: string, duration: number, formula: string, purpose: string) => {
    if (duration <= 0) return;
    steps.push({ label, start, duration, formula, purpose, estimated: true });
    start += duration;
  };

  add('Redirect / queue', nav.redirectQueue, 'pageLoad − other phases', 'Redirects and request queueing (from CSV)');
  add('DNS', nav.dns, 'domainLookupEnd − domainLookupStart', 'DNS resolution (from CSV)');
  add('TCP', nav.connection, 'connectEnd − connectStart', 'TCP handshake (from CSV)');
  add('Server wait', nav.serverWait, 'responseStart − requestStart', 'Request sent → first byte');
  add('Document download', nav.download, 'responseEnd − responseStart', 'Response body download');
  add('DOM build', nav.domProcessing, 'domInteractive − domLoading', 'DOM construction (approx.)');
  add('DOM complete', nav.scriptTime, 'domComplete − domInteractive', 'Post-interactive DOM (approx.)');
  add('Load finish', Math.max(0, nav.pageLoad - start), 'loadEventEnd − navigationStart', 'Remaining to full load');

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

export const WATERFALL_COLORS = ['#93C5FD', '#3B82F6', '#1D4ED8', '#A5B4FC', '#6366F1', '#4338CA', '#D97706', '#B91C1C'];

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

  const nav = navBreakdown({ ...row, practicalMetrics: null });
  if (!nav) return 0;
  switch (key) {
    case 'dns': return nav.dns;
    case 'tcp': return nav.connection;
    case 'tls': return 0;
    case 'ttfb': return nav.ttfb;
    case 'serverWait': return nav.serverWait;
    case 'documentFetch': return nav.serverWait + nav.download;
    case 'domBuild': return nav.domProcessing;
    case 'scriptTime': return nav.scriptTime;
    case 'loadEvent': return nav.loadEvent;
    case 'pageLoad': return nav.pageLoad;
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

/** Status labels matching Lighthouse Good / Needs Improvement / Poor. */
export function lhStatusLabel(s: VitalStatus): string {
  if (s === 'good') return 'Good';
  if (s === 'warn') return 'Needs Improvement';
  return 'Poor';
}

export function worstStatus(...statuses: VitalStatus[]): VitalStatus {
  if (statuses.includes('poor')) return 'poor';
  if (statuses.includes('warn')) return 'warn';
  return 'good';
}

export interface AggregatedPageRow extends StaticResultRow {
  hits: number;
  passCount: number;
  failCount: number;
  aggregateStatus: VitalStatus;
  /** Hits on this page that produced Lighthouse metrics. */
  lighthouseHits: number;
  opportunities?: ReportPageRow['opportunities'];
  lighthouseFile?: string;
  navTimingFile?: string;
  practicalMetrics?: Record<string, PracticalMetric> | null;
  practicalWaterfall?: WaterfallStep[];
  accessibilityScore?: number;
  bestPracticesScore?: number;
  seoScore?: number;
}

function avgField(rows: StaticResultRow[], key: keyof StaticResultRow): number {
  if (!rows.length) return 0;
  const nums = rows.map((r) => Number(r[key]) || 0);
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Group raw hit rows by page URL; averages when hits > 1. */
export function aggregatePageResults(rows: StaticResultRow[]): AggregatedPageRow[] {
  const groups = new Map<string, StaticResultRow[]>();
  for (const row of rows) {
    const key = row.pageUrl || `${row.transaction}|${row.timestamp}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  return [...groups.entries()].map(([, hits]) => {
    const first = hits[0];
    const passCount = hits.filter((h) => h.testStatus === 'PASS').length;
    const failCount = hits.filter((h) => h.testStatus === 'FAIL').length;
    const useAvg = hits.length > 1;
    const pick = <K extends keyof StaticResultRow>(key: K): number =>
      (useAvg ? avgField(hits, key) : Number(first[key]) || 0);

    // Lighthouse runs on only some hits; the others record 0 for every Lighthouse metric.
    // Average Lighthouse metrics over the hits that measured them, or zeros drag them down.
    const lhHits = hits.filter((h) => (Number(h.performanceScore) || 0) > 0 || (Number(h.fcp) || 0) > 0);
    const lhPick = <K extends keyof StaticResultRow>(key: K): number => (lhHits.length ? avgField(lhHits, key) : 0);

    const performanceScore = lhPick('performanceScore');
    const fcp = lhPick('fcp');
    const lcp = lhPick('lcp');
    const cls = lhPick('cls');
    const tbt = lhPick('tbt');
    const speedIndex = lhPick('speedIndex');
    const pageLoadTime = pick('pageLoadTime');
    const lhStatus = pageLighthouseStatus({
      performanceScore, fcp, lcp, cls, tbt, speedIndex, passCount, failCount,
      testStatus: failCount > 0 && passCount === 0 ? 'FAIL' : 'PASS',
    }).status;
    const aggregateStatus: VitalStatus = lhStatus === 'failed' ? 'poor' : lhStatus === 'pending' ? 'warn' : lhStatus;

    return {
      ...first,
      hits: hits.length,
      passCount,
      failCount,
      performanceScore,
      fcp,
      lcp,
      cls,
      tbt,
      speedIndex,
      pageLoadTime,
      networkTime: pick('networkTime'),
      dnsLookupTime: pick('dnsLookupTime'),
      connectionTime: pick('connectionTime'),
      serverProcessingTime: pick('serverProcessingTime'),
      responseTime: pick('responseTime'),
      browserTime: pick('browserTime'),
      domInteractionTime: pick('domInteractionTime'),
      domCompleteTime: pick('domCompleteTime'),
      playwrightPageLoadTime: pick('playwrightPageLoadTime'),
      testStatus: (failCount > 0 && passCount === 0 ? 'FAIL' : 'PASS') as 'PASS' | 'FAIL',
      aggregateStatus,
      lighthouseHits: lhHits.length,
    };
  }).sort((a, b) => (a.pageUrl || '').localeCompare(b.pageUrl || ''));
}

export function mergeAggregatedReportRows(
  results: StaticResultRow[],
  pages: RunReportPage[],
): AggregatedPageRow[] {
  const aggregated = aggregatePageResults(results);
  const byUrl = new Map(pages.map((p) => [p.pageUrl, p]));
  return aggregated.map((r) => {
    const extra = byUrl.get(r.pageUrl);
    return {
      ...r,
      opportunities: extra?.opportunities,
      lighthouseFile: extra?.lighthouseFile,
      navTimingFile: extra?.navTimingFile,
      practicalMetrics: extra?.practicalMetrics ?? null,
      practicalWaterfall: extra?.practicalWaterfall,
      accessibilityScore: extra?.accessibilityScore ?? r.accessibilityScore ?? 0,
      bestPracticesScore: extra?.bestPracticesScore ?? r.bestPracticesScore ?? 0,
      seoScore: extra?.seoScore ?? r.seoScore ?? 0,
    };
  });
}

/** Layer thresholds for Navigation timing impact callouts (ms). */
export const LAYER_THRESHOLDS = {
  network: { good: 500, warn: 1200 },
  server: { good: 800, warn: 1800 },
  browser: { good: 1500, warn: 3000 },
} as const;

export function layerStatus(ms: number, layer: keyof typeof LAYER_THRESHOLDS): VitalStatus {
  const t = LAYER_THRESHOLDS[layer];
  if (ms <= t.good) return 'good';
  if (ms <= t.warn) return 'warn';
  return 'poor';
}

function impactForUx(metric: string, status: VitalStatus): string {
  if (status === 'good') return '';
  const zone = status === 'warn' ? 'amber (Needs Improvement)' : 'red (Poor)';
  const impacts: Record<string, { warn: string; poor: string }> = {
    loading: {
      warn: 'Users wait longer before meaningful content appears, raising bounce risk on first paint and LCP.',
      poor: 'Users experience blank or incomplete screens for several seconds — many abandon before content is useful.',
    },
    stability: {
      warn: 'Page elements shift while reading/tapping, causing mis-taps and frustration on forms and CTAs.',
      poor: 'Severe layout jumps make the UI feel broken; accidental clicks and reading interruptions spike.',
    },
    interactivity: {
      warn: 'Clicks and taps feel sluggish; users may re-tap controls and perceive the app as unresponsive.',
      poor: 'The main thread is blocked long enough that interactions feel frozen — users often refresh or leave.',
    },
  };
  const key = metric.includes('Layout') || metric === 'CLS' ? 'stability'
    : metric.includes('Blocking') || metric.includes('INP') || metric === 'TBT' ? 'interactivity'
      : 'loading';
  return impacts[key][status === 'warn' ? 'warn' : 'poor'] + ` (${zone}).`;
}

function impactForLayer(layer: string, status: VitalStatus): string {
  if (status === 'good') return '';
  const zone = status === 'warn' ? 'amber' : 'red';
  if (layer === 'Network') {
    return status === 'warn'
      ? `Network latency is elevated (${zone}): DNS/connect/download delays add wait before any HTML arrives — mobile and distant users feel this first.`
      : `Network is the bottleneck (${zone}): users sit on a blank screen while DNS, TLS, or payload transfer dominates the journey.`;
  }
  if (layer === 'Server') {
    return status === 'warn'
      ? `Server TTFB is elevated (${zone}): origin processing or missing cache means every navigation waits on the backend before paint can start.`
      : `Server time breaches threshold (${zone}): users perceive the site as “down” or very slow even when the browser is idle — backend/CDN fixes are urgent.`;
  }
  return status === 'warn'
    ? `Browser work is elevated (${zone}): DOM/JS after download delays interactivity; users see content late and struggle to act.`
    : `Browser processing breaches threshold (${zone}): heavy JS/DOM keeps the page unusable after download — users encounter jank and long freezes.`;
}

export interface ExecutiveSummaryModel {
  paragraphs: string[];
  ux: {
    loading: { status: VitalStatus; fcp: number; lcp: number; si: number; impact: string };
    stability: { status: VitalStatus; cls: number; impact: string };
    interactivity: { status: VitalStatus; tbt: number; impact: string };
  };
  layers: {
    dominant: 'Network' | 'Server' | 'Browser';
    network: { avg: number; status: VitalStatus; impact: string };
    server: { avg: number; status: VitalStatus; impact: string };
    browser: { avg: number; status: VitalStatus; impact: string };
  };
}

/** Build a sample-quality executive summary from aggregated page metrics. */
export function buildExecutiveSummary(opts: {
  host: string;
  runId: string;
  rows: AggregatedPageRow[];
  threads?: number | string | null;
  overallLabel: string;
  overallJustification: string;
}): ExecutiveSummaryModel {
  const { host, runId, rows, threads, overallLabel, overallJustification } = opts;
  const n = rows.length || 1;
  const totalHits = rows.reduce((s, r) => s + (r.hits || 1), 0);
  const avg = (fn: (r: AggregatedPageRow) => number) =>
    rows.reduce((s, r) => s + fn(r), 0) / n;

  const avgFcp = avg((r) => r.fcp || 0);
  const avgLcp = avg((r) => r.lcp || 0);
  const avgCls = avg((r) => r.cls || 0);
  const avgTbt = avg((r) => r.tbt || 0);
  const avgSi = avg((r) => r.speedIndex || 0);
  const avgScore = Math.round(avg((r) => (r.performanceScore || 0) * 100));
  const avgPageLoad = avg((r) => r.pageLoadTime || 0);
  const avgNetwork = avgNav(rows, 'network');
  const avgServer = avgNav(rows, 'server');
  const avgBrowser = avgNav(rows, 'browser');

  const loadingStatus = worstStatus(fcpStatus(avgFcp), lcpStatus(avgLcp), siStatus(avgSi));
  const stabilityStatus = clsStatus(avgCls);
  const interactivityStatus = tbtStatus(avgTbt);

  const networkSt = layerStatus(avgNetwork, 'network');
  const serverSt = layerStatus(avgServer, 'server');
  const browserSt = layerStatus(avgBrowser, 'browser');
  const layers = [
    { name: 'Network' as const, avg: avgNetwork, status: networkSt },
    { name: 'Server' as const, avg: avgServer, status: serverSt },
    { name: 'Browser' as const, avg: avgBrowser, status: browserSt },
  ];
  const dominant = layers.reduce((a, b) => (b.avg > a.avg ? b : a)).name;

  const passRate = totalHits
    ? Math.round((rows.reduce((s, r) => s + r.passCount, 0) / totalHits) * 100)
    : 0;

  const uxImpactParts = [
    impactForUx('loading', loadingStatus),
    impactForUx('CLS', stabilityStatus),
    impactForUx('TBT', interactivityStatus),
  ].filter(Boolean);

  const layerImpactParts = layers
    .map((l) => impactForLayer(l.name, l.status))
    .filter(Boolean);

  const paragraphs = [
    `This executive summary covers ${n} unique page(s) of ${host} (run #${runId}) across ${totalHits} hit(s)${threads ? ` with ${threads} concurrent browser thread(s)` : ''}. Metrics below are aggregates (averages where a page was hit more than once).`,
    `Overall system status is ${overallLabel}. ${overallJustification} Aggregate Lighthouse performance score is ${avgScore}/100 with a ${passRate}% pass rate and average navigation page load of ${(avgPageLoad / 1000).toFixed(1)}s.`,
    `Loading experience (FCP ${(avgFcp / 1000).toFixed(1)}s, LCP ${(avgLcp / 1000).toFixed(1)}s, Speed Index ${(avgSi / 1000).toFixed(1)}s) is rated ${lhStatusLabel(loadingStatus)}. Visual stability (CLS ${avgCls.toFixed(2)}) is ${lhStatusLabel(stabilityStatus)}. Interactivity (TBT ${Math.round(avgTbt)}ms, approximating INP) is ${lhStatusLabel(interactivityStatus)}.`,
    uxImpactParts.length
      ? `User-impact from UX metrics: ${uxImpactParts.join(' ')}`
      : 'User-impact from UX metrics: Core Web Vitals sit in the Good band on aggregate — users should see prompt, stable, responsive pages for the measured journeys.',
    `Navigation Timing breakdown shows average Network ${Math.round(avgNetwork)}ms, Server ${Math.round(avgServer)}ms, and Browser ${Math.round(avgBrowser)}ms. The dominant layer is ${dominant}, accounting for the largest share of end-to-end wait.`,
    layerImpactParts.length
      ? `Layer threshold impact: ${layerImpactParts.join(' ')}`
      : 'Layer threshold impact: Network, Server, and Browser averages are within fast thresholds — no single layer is currently dominating user wait time beyond guidance.',
  ];

  return {
    paragraphs,
    ux: {
      loading: {
        status: loadingStatus,
        fcp: avgFcp,
        lcp: avgLcp,
        si: avgSi,
        impact: impactForUx('loading', loadingStatus) || 'Within Good thresholds — content becomes useful quickly.',
      },
      stability: {
        status: stabilityStatus,
        cls: avgCls,
        impact: impactForUx('CLS', stabilityStatus) || 'Within Good thresholds — layout remains stable while users read and tap.',
      },
      interactivity: {
        status: interactivityStatus,
        tbt: avgTbt,
        impact: impactForUx('TBT', interactivityStatus) || 'Within Good thresholds — interactions stay responsive.',
      },
    },
    layers: {
      dominant,
      network: { avg: avgNetwork, status: networkSt, impact: impactForLayer('Network', networkSt) || 'Within guidance.' },
      server: { avg: avgServer, status: serverSt, impact: impactForLayer('Server', serverSt) || 'Within guidance.' },
      browser: { avg: avgBrowser, status: browserSt, impact: impactForLayer('Browser', browserSt) || 'Within guidance.' },
    },
  };
}

