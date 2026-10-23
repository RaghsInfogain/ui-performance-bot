/**
 * Build a comparison between two run report payloads (same heads as a single report).
 */
function avg(nums) {
  const vals = nums.filter((n) => typeof n === 'number' && !Number.isNaN(n));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function pctDelta(base, target) {
  if (base == null || target == null) return null;
  if (base === 0) return target === 0 ? 0 : 100;
  return ((target - base) / Math.abs(base)) * 100;
}

function verdictForMetric(key, delta) {
  if (delta == null || Math.abs(delta) < 1) return 'unchanged';
  // Higher is better for score / passRate
  if (key === 'avgScore' || key === 'passRate' || key === 'performanceScore') {
    return delta > 0 ? 'improved' : 'degraded';
  }
  // Lower is better for timings / CLS
  return delta < 0 ? 'improved' : 'degraded';
}

function pageKey(row) {
  return (row.pageUrl || row.url || '').split('#')[0] || row.transaction || '';
}

function summarizeReport(report) {
  const results = report?.results || [];
  const pages = report?.pages || [];
  const analysis = report?.analysis?.summary || {};
  const scores = results.map((r) => Number(r.performanceScore) || 0).filter((s) => s > 0);
  const pass = results.filter((r) => r.testStatus === 'PASS').length;
  const fail = results.filter((r) => r.testStatus === 'FAIL').length;
  return {
    totalPages: results.length || pages.length || analysis.total || 0,
    avgScore: analysis.avgScore ?? (scores.length ? avg(scores) : null),
    avgLcp: analysis.avgLcp ?? avg(results.map((r) => Number(r.lcp) || 0)),
    avgFcp: analysis.avgFcp ?? avg(results.map((r) => Number(r.fcp) || 0)),
    avgTbt: analysis.avgTbt ?? avg(results.map((r) => Number(r.tbt) || 0)),
    avgCls: analysis.avgCls ?? avg(results.map((r) => Number(r.cls) || 0)),
    avgSi: avg(results.map((r) => Number(r.speedIndex) || 0)),
    avgPageLoad: analysis.avgPageLoad ?? avg(results.map((r) => Number(r.pageLoadTime) || 0)),
    avgNetwork: analysis.avgNetwork ?? avg(results.map((r) => Number(r.networkTime) || 0)),
    passRate: analysis.passRate ?? (pass + fail > 0 ? (pass / (pass + fail)) * 100 : null),
    passCount: pass,
    failCount: fail,
  };
}

function metricProp(label, key, baseVal, targetVal, unit = 'ms', higherIsBetter = false) {
  const delta = (baseVal != null && targetVal != null) ? targetVal - baseVal : null;
  const pct = pctDelta(baseVal, targetVal);
  let status = 'unchanged';
  if (delta != null && Math.abs(delta) >= (unit === 'score' || unit === '%' ? 0.01 : 1)) {
    if (higherIsBetter) status = delta > 0 ? 'improved' : 'degraded';
    else status = delta < 0 ? 'improved' : 'degraded';
  }
  return {
    label,
    key,
    baseline: baseVal,
    current: targetVal,
    delta,
    pctDelta: pct,
    unit,
    status,
  };
}

export function buildComparisonReport(baseRunId, targetRunId, baseReport, targetReport) {
  const baseSum = summarizeReport(baseReport);
  const targetSum = summarizeReport(targetReport);

  const kpi = [
    metricProp('Performance Score', 'avgScore', baseSum.avgScore, targetSum.avgScore, 'score', true),
    metricProp('Pass Rate', 'passRate', baseSum.passRate, targetSum.passRate, '%', true),
    metricProp('Avg LCP', 'avgLcp', baseSum.avgLcp, targetSum.avgLcp, 'ms', false),
    metricProp('Avg FCP', 'avgFcp', baseSum.avgFcp, targetSum.avgFcp, 'ms', false),
    metricProp('Avg TBT', 'avgTbt', baseSum.avgTbt, targetSum.avgTbt, 'ms', false),
    metricProp('Avg CLS', 'avgCls', baseSum.avgCls, targetSum.avgCls, 'cls', false),
    metricProp('Avg Speed Index', 'avgSi', baseSum.avgSi, targetSum.avgSi, 'ms', false),
    metricProp('Avg Page Load', 'avgPageLoad', baseSum.avgPageLoad, targetSum.avgPageLoad, 'ms', false),
    metricProp('Avg Network', 'avgNetwork', baseSum.avgNetwork, targetSum.avgNetwork, 'ms', false),
  ];

  const improved = kpi.filter((k) => k.status === 'improved').length;
  const degraded = kpi.filter((k) => k.status === 'degraded').length;
  let overall = 'unchanged';
  if (improved > degraded) overall = 'improved';
  else if (degraded > improved) overall = 'degraded';

  const baseByUrl = new Map();
  for (const row of (baseReport?.results || [])) {
    const key = pageKey(row);
    if (key) baseByUrl.set(key, row);
  }
  const targetByUrl = new Map();
  for (const row of (targetReport?.results || [])) {
    const key = pageKey(row);
    if (key) targetByUrl.set(key, row);
  }

  const allUrls = new Set([...baseByUrl.keys(), ...targetByUrl.keys()]);
  const pages = [];
  for (const url of allUrls) {
    const b = baseByUrl.get(url);
    const t = targetByUrl.get(url);
    const scoreDelta = (b && t)
      ? (Number(t.performanceScore || 0) - Number(b.performanceScore || 0))
      : null;
    const lcpDelta = (b && t) ? (Number(t.lcp || 0) - Number(b.lcp || 0)) : null;
    let pageStatus = 'unchanged';
    if (b && t) {
      const scoreVerdict = verdictForMetric('performanceScore', (scoreDelta || 0) * 100);
      const lcpVerdict = verdictForMetric('lcp', lcpDelta);
      if (scoreVerdict === 'improved' || lcpVerdict === 'improved') pageStatus = 'improved';
      if (scoreVerdict === 'degraded' || lcpVerdict === 'degraded') {
        // Prefer degraded if mixed but score dropped
        if (scoreVerdict === 'degraded') pageStatus = 'degraded';
      }
      if (scoreVerdict === 'degraded' && lcpVerdict === 'improved') pageStatus = 'mixed';
      if (scoreVerdict === 'improved' && lcpVerdict === 'degraded') pageStatus = 'mixed';
    } else if (!b && t) pageStatus = 'new';
    else if (b && !t) pageStatus = 'removed';

    pages.push({
      pageUrl: url,
      transaction: t?.transaction || b?.transaction || '',
      baseline: b ? {
        score: Number(b.performanceScore || 0),
        fcp: Number(b.fcp || 0),
        lcp: Number(b.lcp || 0),
        tbt: Number(b.tbt || 0),
        cls: Number(b.cls || 0),
        si: Number(b.speedIndex || 0),
        pageLoad: Number(b.pageLoadTime || 0),
        testStatus: b.testStatus,
      } : null,
      current: t ? {
        score: Number(t.performanceScore || 0),
        fcp: Number(t.fcp || 0),
        lcp: Number(t.lcp || 0),
        tbt: Number(t.tbt || 0),
        cls: Number(t.cls || 0),
        si: Number(t.speedIndex || 0),
        pageLoad: Number(t.pageLoadTime || 0),
        testStatus: t.testStatus,
      } : null,
      deltas: (b && t) ? {
        score: scoreDelta,
        fcp: Number(t.fcp || 0) - Number(b.fcp || 0),
        lcp: lcpDelta,
        tbt: Number(t.tbt || 0) - Number(b.tbt || 0),
        cls: Number(t.cls || 0) - Number(b.cls || 0),
        si: Number(t.speedIndex || 0) - Number(b.speedIndex || 0),
        pageLoad: Number(t.pageLoadTime || 0) - Number(b.pageLoadTime || 0),
      } : null,
      status: pageStatus,
    });
  }

  pages.sort((a, b) => {
    const order = { degraded: 0, mixed: 1, improved: 2, new: 3, removed: 4, unchanged: 5 };
    return (order[a.status] ?? 9) - (order[b.status] ?? 9);
  });

  const executiveSummary = overall === 'improved'
    ? `Performance improved versus baseline run ${baseRunId}: ${improved} of ${kpi.length} headline metrics moved in a favorable direction, while ${degraded} degraded.`
    : overall === 'degraded'
      ? `Performance degraded versus baseline run ${baseRunId}: ${degraded} of ${kpi.length} headline metrics worsened, while ${improved} improved.`
      : `Overall performance is largely unchanged versus baseline run ${baseRunId} (${improved} improved, ${degraded} degraded).`;

  return {
    baselineRunId: baseRunId,
    currentRunId: targetRunId,
    overall,
    executiveSummary,
    generatedAt: new Date().toISOString(),
    baselineSummary: baseSum,
    currentSummary: targetSum,
    kpi,
    pages,
    charts: {
      scores: pages.filter((p) => p.baseline && p.current).slice(0, 40).map((p) => ({
        name: (p.transaction || p.pageUrl || '').slice(0, 24),
        baseline: Math.round((p.baseline.score || 0) * 100),
        current: Math.round((p.current.score || 0) * 100),
      })),
      lcp: pages.filter((p) => p.baseline && p.current).slice(0, 40).map((p) => ({
        name: (p.transaction || p.pageUrl || '').slice(0, 24),
        baseline: Math.round(p.baseline.lcp || 0),
        current: Math.round(p.current.lcp || 0),
      })),
    },
  };
}
