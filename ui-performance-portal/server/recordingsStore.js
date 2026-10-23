import { query } from './db/pool.js';

export async function ensureRecordingsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS recordings (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      start_url TEXT NOT NULL DEFAULT '',
      steps JSONB NOT NULL DEFAULT '[]',
      step_count INTEGER NOT NULL DEFAULT 0,
      url_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_recordings_updated ON recordings (updated_at DESC)`);
}

function mapRecording(row) {
  return {
    id: row.id,
    name: row.name,
    startUrl: row.start_url ?? '',
    steps: row.steps ?? [],
    stepCount: row.step_count ?? (Array.isArray(row.steps) ? row.steps.length : 0),
    urlCount: row.url_count ?? 0,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

export async function listRecordings() {
  await ensureRecordingsTable();
  const { rows } = await query(
    `SELECT id, name, start_url, step_count, url_count, created_at, updated_at
     FROM recordings ORDER BY updated_at DESC`,
  );
  return rows.map((r) => mapRecording({ ...r, steps: [] }));
}

export async function getRecording(id) {
  await ensureRecordingsTable();
  const { rows } = await query('SELECT * FROM recordings WHERE id = $1', [id]);
  return rows[0] ? mapRecording(rows[0]) : null;
}

export async function saveRecording({ id, name, startUrl, steps, urlCount }) {
  await ensureRecordingsTable();
  const recordingId = id || `recording_${Date.now()}`;
  const stepList = Array.isArray(steps) ? steps : [];
  const now = new Date().toISOString();

  await query(
    `INSERT INTO recordings (id, name, start_url, steps, step_count, url_count, created_at, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $7)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       start_url = EXCLUDED.start_url,
       steps = EXCLUDED.steps,
       step_count = EXCLUDED.step_count,
       url_count = EXCLUDED.url_count,
       updated_at = EXCLUDED.updated_at`,
    [
      recordingId,
      (name || 'Recorded_Flow').trim() || 'Recorded_Flow',
      startUrl ?? '',
      JSON.stringify(stepList),
      stepList.length,
      urlCount ?? 0,
      now,
    ],
  );

  return getRecording(recordingId);
}

export async function updateRecording(id, { name, steps, startUrl, urlCount }) {
  await ensureRecordingsTable();
  const existing = await getRecording(id);
  if (!existing) return null;

  const nextName = name != null ? (String(name).trim() || existing.name) : existing.name;
  const nextSteps = steps != null ? steps : existing.steps;
  const nextStart = startUrl != null ? startUrl : existing.startUrl;
  const nextUrlCount = urlCount != null ? urlCount : existing.urlCount;

  await query(
    `UPDATE recordings
     SET name = $2, start_url = $3, steps = $4::jsonb, step_count = $5, url_count = $6, updated_at = NOW()
     WHERE id = $1`,
    [id, nextName, nextStart, JSON.stringify(nextSteps), nextSteps.length, nextUrlCount],
  );
  return getRecording(id);
}

export async function deleteRecording(id) {
  await ensureRecordingsTable();
  const { rowCount } = await query('DELETE FROM recordings WHERE id = $1', [id]);
  return rowCount > 0;
}

export async function renameRecording(id, name) {
  const trimmed = (name ?? '').trim();
  if (!trimmed) throw new Error('Recording name is required');
  await ensureRecordingsTable();
  const { rows } = await query(
    `UPDATE recordings SET name = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id, trimmed],
  );
  return rows[0] ? mapRecording(rows[0]) : null;
}
