import { query } from './db/pool.js';

export async function ensureReportTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS run_reports (
      run_id TEXT PRIMARY KEY REFERENCES runs(run_id) ON DELETE CASCADE,
      payload JSONB NOT NULL,
      generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      generator TEXT NOT NULL DEFAULT 'auto'
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      frequency TEXT NOT NULL CHECK (frequency IN ('hourly', 'daily', 'weekly')),
      cron_minute INTEGER NOT NULL DEFAULT 0,
      cron_hour INTEGER NOT NULL DEFAULT 9,
      cron_weekday INTEGER,
      mode TEXT NOT NULL DEFAULT 'static',
      script_id TEXT,
      crawl_run_id TEXT,
      test_suite TEXT,
      config_snapshot JSONB NOT NULL DEFAULT '{}',
      last_run_at TIMESTAMPTZ,
      last_run_id TEXT,
      next_run_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_schedules_next ON schedules (enabled, next_run_at)`);
}

export async function getCachedReport(runId) {
  const { rows } = await query('SELECT * FROM run_reports WHERE run_id = $1', [runId]);
  if (!rows[0]) return null;
  return {
    ...rows[0].payload,
    meta: {
      ...(rows[0].payload?.meta || {}),
      cached: true,
      generatedAt: rows[0].generated_at instanceof Date
        ? rows[0].generated_at.toISOString()
        : rows[0].generated_at,
      generator: rows[0].generator,
    },
  };
}

export async function saveCachedReport(runId, payload, generator = 'auto') {
  await query(
    `INSERT INTO run_reports (run_id, payload, generated_at, generator)
     VALUES ($1, $2::jsonb, NOW(), $3)
     ON CONFLICT (run_id) DO UPDATE SET
       payload = EXCLUDED.payload,
       generated_at = EXCLUDED.generated_at,
       generator = EXCLUDED.generator`,
    [runId, JSON.stringify(payload), generator],
  );
}

export async function deleteCachedReport(runId) {
  await query('DELETE FROM run_reports WHERE run_id = $1', [runId]);
}

function mapSchedule(row) {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    frequency: row.frequency,
    cronMinute: row.cron_minute,
    cronHour: row.cron_hour,
    cronWeekday: row.cron_weekday,
    mode: row.mode,
    scriptId: row.script_id,
    crawlRunId: row.crawl_run_id,
    testSuite: row.test_suite,
    configSnapshot: row.config_snapshot || {},
    lastRunAt: row.last_run_at instanceof Date ? row.last_run_at.toISOString() : row.last_run_at,
    lastRunId: row.last_run_id,
    nextRunAt: row.next_run_at instanceof Date ? row.next_run_at.toISOString() : row.next_run_at,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

export function computeNextRunAt(schedule, from = new Date()) {
  const d = new Date(from.getTime());
  d.setSeconds(0, 0);
  const minute = schedule.cronMinute ?? schedule.cron_minute ?? 0;
  const hour = schedule.cronHour ?? schedule.cron_hour ?? 9;
  const weekday = schedule.cronWeekday ?? schedule.cron_weekday;
  const frequency = schedule.frequency;

  if (frequency === 'hourly') {
    d.setMinutes(minute);
    if (d <= from) d.setHours(d.getHours() + 1);
    return d;
  }

  if (frequency === 'daily') {
    d.setHours(hour, minute, 0, 0);
    if (d <= from) d.setDate(d.getDate() + 1);
    return d;
  }

  // weekly — cronWeekday: 0=Sun … 6=Sat
  const targetDow = weekday == null ? 1 : Number(weekday);
  d.setHours(hour, minute, 0, 0);
  let guard = 0;
  while ((d.getDay() !== targetDow || d <= from) && guard < 14) {
    d.setDate(d.getDate() + 1);
    d.setHours(hour, minute, 0, 0);
    guard += 1;
  }
  return d;
}

export async function listSchedules() {
  await ensureReportTables();
  const { rows } = await query('SELECT * FROM schedules ORDER BY updated_at DESC');
  return rows.map(mapSchedule);
}

export async function getSchedule(id) {
  await ensureReportTables();
  const { rows } = await query('SELECT * FROM schedules WHERE id = $1', [id]);
  return rows[0] ? mapSchedule(rows[0]) : null;
}

export async function saveSchedule(input) {
  await ensureReportTables();
  const id = input.id || `sched_${Date.now()}`;
  const next = computeNextRunAt({
    frequency: input.frequency,
    cronMinute: input.cronMinute ?? 0,
    cronHour: input.cronHour ?? 9,
    cronWeekday: input.cronWeekday,
  });

  await query(
    `INSERT INTO schedules (
       id, name, enabled, frequency, cron_minute, cron_hour, cron_weekday,
       mode, script_id, crawl_run_id, test_suite, config_snapshot, next_run_at, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,NOW(),NOW())
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       enabled = EXCLUDED.enabled,
       frequency = EXCLUDED.frequency,
       cron_minute = EXCLUDED.cron_minute,
       cron_hour = EXCLUDED.cron_hour,
       cron_weekday = EXCLUDED.cron_weekday,
       mode = EXCLUDED.mode,
       script_id = EXCLUDED.script_id,
       crawl_run_id = EXCLUDED.crawl_run_id,
       test_suite = EXCLUDED.test_suite,
       config_snapshot = EXCLUDED.config_snapshot,
       next_run_at = EXCLUDED.next_run_at,
       updated_at = NOW()`,
    [
      id,
      input.name || 'Scheduled run',
      input.enabled !== false,
      input.frequency || 'daily',
      input.cronMinute ?? 0,
      input.cronHour ?? 9,
      input.cronWeekday ?? null,
      input.mode || 'static',
      input.scriptId || null,
      input.crawlRunId || null,
      input.testSuite || null,
      JSON.stringify(input.configSnapshot || {}),
      next.toISOString(),
    ],
  );
  return getSchedule(id);
}

export async function deleteSchedule(id) {
  await ensureReportTables();
  const { rowCount } = await query('DELETE FROM schedules WHERE id = $1', [id]);
  return rowCount > 0;
}

export async function markScheduleRan(id, runId) {
  const schedule = await getSchedule(id);
  if (!schedule) return null;
  const next = computeNextRunAt(schedule, new Date());
  await query(
    `UPDATE schedules
     SET last_run_at = NOW(), last_run_id = $2, next_run_at = $3, updated_at = NOW()
     WHERE id = $1`,
    [id, runId, next.toISOString()],
  );
  return getSchedule(id);
}

export async function listDueSchedules(now = new Date()) {
  await ensureReportTables();
  const { rows } = await query(
    `SELECT * FROM schedules
     WHERE enabled = TRUE AND next_run_at IS NOT NULL AND next_run_at <= $1
     ORDER BY next_run_at ASC
     LIMIT 10`,
    [now.toISOString()],
  );
  return rows.map(mapSchedule);
}
