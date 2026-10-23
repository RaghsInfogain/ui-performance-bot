import { query } from './db/pool.js';

function mapRun(row) {
  if (!row) return null;
  return {
    runId: row.run_id,
    mode: row.mode,
    status: row.status,
    startedAt: row.started_at instanceof Date ? row.started_at.toISOString() : row.started_at,
    endedAt: row.ended_at instanceof Date ? row.ended_at?.toISOString() : row.ended_at,
    hostname: row.hostname ?? '',
    configSnapshot: row.config_snapshot ?? {},
    testDurationSeconds: row.test_duration_seconds,
    multiThreading: row.multi_threading ?? 1,
    urlsTotal: row.urls_total ?? 0,
    scriptId: row.script_id,
    crawlRunId: row.crawl_run_id,
    exitCode: row.exit_code,
  };
}

export async function upsertRun(meta) {
  await query(
    `INSERT INTO runs (
       run_id, mode, status, started_at, ended_at, hostname, config_snapshot,
       test_duration_seconds, multi_threading, urls_total, script_id, crawl_run_id, exit_code, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, NOW())
     ON CONFLICT (run_id) DO UPDATE SET
       mode = EXCLUDED.mode,
       status = EXCLUDED.status,
       started_at = COALESCE(EXCLUDED.started_at, runs.started_at),
       ended_at = EXCLUDED.ended_at,
       hostname = EXCLUDED.hostname,
       config_snapshot = EXCLUDED.config_snapshot,
       test_duration_seconds = EXCLUDED.test_duration_seconds,
       multi_threading = EXCLUDED.multi_threading,
       urls_total = EXCLUDED.urls_total,
       script_id = EXCLUDED.script_id,
       crawl_run_id = EXCLUDED.crawl_run_id,
       exit_code = EXCLUDED.exit_code,
       updated_at = NOW()`,
    [
      meta.runId,
      meta.mode ?? 'static',
      meta.status ?? 'running',
      meta.startedAt ?? null,
      meta.endedAt ?? null,
      meta.hostname ?? '',
      JSON.stringify(meta.configSnapshot ?? {}),
      meta.testDurationSeconds ?? null,
      meta.multiThreading ?? 1,
      meta.urlsTotal ?? 0,
      meta.scriptId ?? null,
      meta.crawlRunId ?? null,
      meta.exitCode ?? null,
    ],
  );
  return getRun(meta.runId);
}

export async function getRun(runId) {
  const { rows } = await query('SELECT * FROM runs WHERE run_id = $1', [runId]);
  return mapRun(rows[0]);
}

export async function listRuns() {
  const { rows } = await query('SELECT * FROM runs ORDER BY started_at DESC NULLS LAST, run_id DESC');
  return rows.map(mapRun);
}

export async function updateRunStatus(runId, patch) {
  const existing = await getRun(runId);
  if (!existing) {
    return upsertRun({ runId, ...patch });
  }
  return upsertRun({ ...existing, ...patch });
}

export async function deleteRun(runId) {
  await query('DELETE FROM runs WHERE run_id = $1', [runId]);
}

export async function upsertRunResults(runId, results) {
  if (!results?.length) return;
  const run = await getRun(runId);
  if (!run) {
    await upsertRun({ runId, status: 'completed', startedAt: new Date().toISOString() });
  }
  // Chunked upserts to avoid blocking the event loop on multi-hit runs
  const chunkSize = 100;
  for (let offset = 0; offset < results.length; offset += chunkSize) {
    const chunk = results.slice(offset, offset + chunkSize);
    await Promise.all(chunk.map((r) => query(
      `INSERT INTO run_results (
         run_id, page_url, transaction, timestamp, hostname,
         fcp, lcp, tbt, cls, speed_index, performance_score, page_load_time,
         network_time, dns_lookup_time, connection_time, server_processing_time,
         response_time, browser_time, dom_interaction_time, dom_complete_time,
         playwright_page_load_time, element_load_time, test_status, failure_reason, raw
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25
       )
       ON CONFLICT (run_id, page_url) DO UPDATE SET
         transaction = EXCLUDED.transaction,
         timestamp = EXCLUDED.timestamp,
         hostname = EXCLUDED.hostname,
         fcp = EXCLUDED.fcp, lcp = EXCLUDED.lcp, tbt = EXCLUDED.tbt, cls = EXCLUDED.cls,
         speed_index = EXCLUDED.speed_index, performance_score = EXCLUDED.performance_score,
         page_load_time = EXCLUDED.page_load_time, network_time = EXCLUDED.network_time,
         dns_lookup_time = EXCLUDED.dns_lookup_time, connection_time = EXCLUDED.connection_time,
         server_processing_time = EXCLUDED.server_processing_time, response_time = EXCLUDED.response_time,
         browser_time = EXCLUDED.browser_time, dom_interaction_time = EXCLUDED.dom_interaction_time,
         dom_complete_time = EXCLUDED.dom_complete_time, playwright_page_load_time = EXCLUDED.playwright_page_load_time,
         element_load_time = EXCLUDED.element_load_time, test_status = EXCLUDED.test_status,
         failure_reason = EXCLUDED.failure_reason, raw = EXCLUDED.raw`,
      [
        runId,
        r.pageUrl,
        r.transaction ?? '',
        r.timestamp ?? null,
        r.hostname ?? null,
        r.fcp ?? 0, r.lcp ?? 0, r.tbt ?? 0, r.cls ?? 0, r.speedIndex ?? 0,
        r.performanceScore ?? 0, r.pageLoadTime ?? 0, r.networkTime ?? 0,
        r.dnsLookupTime ?? 0, r.connectionTime ?? 0, r.serverProcessingTime ?? 0,
        r.responseTime ?? 0, r.browserTime ?? 0, r.domInteractionTime ?? 0,
        r.domCompleteTime ?? 0, r.playwrightPageLoadTime ?? 0,
        r.elementLoadTime ?? 'N/A', r.testStatus ?? 'PASS', r.failureReason ?? '',
        JSON.stringify(r),
      ],
    )));
  }
}

export async function getRunResults(runId) {
  const { rows } = await query(
    `SELECT * FROM run_results WHERE run_id = $1 ORDER BY id ASC`,
    [runId],
  );
  return rows.map((r) => ({
    runId: r.run_id,
    timestamp: r.timestamp ?? '',
    hostname: r.hostname ?? '',
    transaction: r.transaction ?? '',
    pageUrl: r.page_url,
    fcp: Number(r.fcp) || 0,
    lcp: Number(r.lcp) || 0,
    tbt: Number(r.tbt) || 0,
    cls: Number(r.cls) || 0,
    speedIndex: Number(r.speed_index) || 0,
    performanceScore: Number(r.performance_score) || 0,
    pageLoadTime: Number(r.page_load_time) || 0,
    networkTime: Number(r.network_time) || 0,
    dnsLookupTime: Number(r.dns_lookup_time) || 0,
    connectionTime: Number(r.connection_time) || 0,
    serverProcessingTime: Number(r.server_processing_time) || 0,
    responseTime: Number(r.response_time) || 0,
    browserTime: Number(r.browser_time) || 0,
    domInteractionTime: Number(r.dom_interaction_time) || 0,
    domCompleteTime: Number(r.dom_complete_time) || 0,
    playwrightPageLoadTime: Number(r.playwright_page_load_time) || 0,
    elementLoadTime: r.element_load_time ?? 'N/A',
    testStatus: r.test_status ?? 'PASS',
    failureReason: r.failure_reason ?? '',
  }));
}

export async function upsertCrawl(crawl) {
  await query(
    `INSERT INTO crawls (id, start_url, status, error, urls_found, started_at, ended_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status,
       error = EXCLUDED.error,
       urls_found = EXCLUDED.urls_found,
       ended_at = EXCLUDED.ended_at`,
    [
      crawl.id,
      crawl.startUrl,
      crawl.status,
      crawl.error ?? null,
      crawl.urlsFound ?? 0,
      crawl.startedAt ?? new Date().toISOString(),
      crawl.endedAt ?? null,
    ],
  );
}

export async function replaceCrawlUrls(crawlId, urls) {
  await query('DELETE FROM crawl_urls WHERE crawl_id = $1', [crawlId]);
  for (let i = 0; i < urls.length; i++) {
    const u = urls[i];
    await query(
      `INSERT INTO crawl_urls (crawl_id, row_index, transaction_name, page_url, element_identifier, element_selector)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [crawlId, i, u.transactionName ?? '', u.pageUrl, u.elementIdentifier ?? 'NA', u.elementSelector ?? 'NA'],
    );
  }
  await query('UPDATE crawls SET urls_found = $2 WHERE id = $1', [crawlId, urls.length]);
}

export async function getCrawl(crawlId) {
  const { rows } = await query('SELECT * FROM crawls WHERE id = $1', [crawlId]);
  if (!rows[0]) return null;
  const c = rows[0];
  const urls = await getCrawlUrls(crawlId);
  return {
    id: c.id,
    startUrl: c.start_url,
    status: c.status,
    error: c.error,
    urlsFound: c.urls_found,
    startedAt: c.started_at instanceof Date ? c.started_at.toISOString() : c.started_at,
    endedAt: c.ended_at instanceof Date ? c.ended_at?.toISOString() : c.ended_at,
    urls,
  };
}

export async function getCrawlUrls(crawlId) {
  const { rows } = await query(
    `SELECT * FROM crawl_urls WHERE crawl_id = $1 ORDER BY row_index ASC`,
    [crawlId],
  );
  return rows.map((r, i) => ({
    id: String(i + 1),
    transactionName: r.transaction_name,
    pageUrl: r.page_url,
    elementIdentifier: r.element_identifier,
    elementSelector: r.element_selector,
    crawlRunId: crawlId,
  }));
}
