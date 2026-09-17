export function buildRunReport(results) {
  if (!results.length) {
    return {
      summary: { total: 0, passRate: 0, avgScore: 0, avgLcp: 0, avgPageLoad: 0 },
      findings: [],
      charts: { scores: [], navigation: [], lighthouse: [] },
    };
  }

  const pass = results.filter((r) => r.testStatus === 'PASS').length;
  const avg = (key) => results.reduce((s, r) => s + (Number(r[key]) || 0), 0) / results.length;

  const findings = [];

  for (const r of results) {
    const issues = [];
    if (r.lcp > 2500) issues.push(`LCP ${r.lcp}ms exceeds 2.5s threshold`);
    if (r.fcp > 1800) issues.push(`FCP ${r.fcp}ms exceeds 1.8s threshold`);
    if (r.cls > 0.1) issues.push(`CLS ${r.cls.toFixed(3)} exceeds 0.1 threshold`);
    if (r.tbt > 300) issues.push(`TBT ${r.tbt}ms exceeds 300ms threshold`);
    if (r.performanceScore < 0.5) issues.push(`Performance score ${Math.round(r.performanceScore * 100)} is below 50`);
    if (r.pageLoadTime > 3000) issues.push(`Navigation page load ${r.pageLoadTime}ms exceeds 3s`);
    if (r.dnsLookupTime > 200) issues.push(`DNS lookup ${r.dnsLookupTime}ms is slow`);
    if (r.serverProcessingTime > 600) issues.push(`Server processing ${r.serverProcessingTime}ms is high`);

    if (issues.length) {
      findings.push({
        transaction: r.transaction,
        pageUrl: r.pageUrl,
        severity: issues.length >= 3 ? 'high' : issues.length >= 2 ? 'medium' : 'low',
        issues,
        testStatus: r.testStatus,
      });
    }
  }

  findings.sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 };
    return rank[a.severity] - rank[b.severity];
  });

  return {
    summary: {
      total: results.length,
      passRate: Math.round((pass / results.length) * 100),
      avgScore: Math.round(avg('performanceScore') * 100),
      avgLcp: Math.round(avg('lcp')),
      avgFcp: Math.round(avg('fcp')),
      avgPageLoad: Math.round(avg('pageLoadTime')),
      avgNetwork: Math.round(avg('networkTime')),
      avgDns: Math.round(avg('dnsLookupTime')),
      avgTbt: Math.round(avg('tbt')),
      avgCls: Number(avg('cls').toFixed(3)),
    },
    findings,
    charts: {
      scores: results.map((r) => ({
        name: r.transaction?.slice(0, 20) || r.pageUrl.slice(0, 30),
        score: Math.round(r.performanceScore * 100),
        lcp: r.lcp,
        pageLoad: r.pageLoadTime,
      })),
      navigation: results.map((r) => ({
        name: r.transaction?.slice(0, 16) || 'page',
        dns: r.dnsLookupTime,
        connection: r.connectionTime,
        server: r.serverProcessingTime,
        response: r.responseTime,
        browser: r.browserTime,
        dom: r.domCompleteTime,
      })),
      lighthouse: results.map((r) => ({
        name: r.transaction?.slice(0, 16) || 'page',
        fcp: r.fcp,
        lcp: r.lcp,
        tbt: r.tbt,
        cls: Number((r.cls * 1000).toFixed(0)),
        speedIndex: r.speedIndex,
      })),
    },
  };
}
