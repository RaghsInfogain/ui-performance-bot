import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, withClient } from './db/pool.js';
import { parseCsvFile, parseCsvAllRows, toCsvRow, countUrlsInCsvFile, countRowsInCsvFile } from './csvUtils.js';
import { upgradeScriptedRows } from './recorder.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.join(__dirname, '../data/scripts');
const STATIC_DIR = path.join(SCRIPTS_DIR, 'static');
const SCRIPTED_DIR = path.join(SCRIPTS_DIR, 'scripted');
const DATA_DIR = path.join(SCRIPTS_DIR, 'data');

function ensureDirs() {
  [SCRIPTS_DIR, STATIC_DIR, SCRIPTED_DIR, DATA_DIR].forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

function mapScript(row) {
  return {
    id: row.id,
    scriptNumber: row.script_number != null ? Number(row.script_number) : null,
    name: row.name,
    type: row.type,
    source: row.source,
    crawlRunId: row.crawl_run_id,
    description: row.description ?? '',
    stepCount: row.step_count ?? 0,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    filePath: materializePath(row.id, row.type),
    testDataRows: row.data_rows != null ? Number(row.data_rows) : 0,
  };
}

/** Ensure every script has a unique numeric Script ID (backfill for older rows). */
export async function ensureScriptNumbers() {
  try {
    await query(`ALTER TABLE scripts ADD COLUMN IF NOT EXISTS script_number SERIAL`);
  } catch {
    /* column may already exist with a different default */
  }
  try {
    await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_scripts_script_number ON scripts (script_number)`);
  } catch {
    /* ignore duplicate index */
  }
  await query(`
    WITH missing AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn
      FROM scripts
      WHERE script_number IS NULL
    ),
    base AS (
      SELECT COALESCE(MAX(script_number), 0) AS max_n FROM scripts
    )
    UPDATE scripts s
    SET script_number = base.max_n + missing.rn
    FROM missing, base
    WHERE s.id = missing.id
  `);
  try {
    await query(`
      SELECT setval(
        pg_get_serial_sequence('scripts', 'script_number'),
        COALESCE((SELECT MAX(script_number) FROM scripts), 1)
      )
    `);
  } catch {
    /* sequence may not exist yet on some installs */
  }
}

function materializePath(id, type) {
  return path.join(type === 'static' ? STATIC_DIR : SCRIPTED_DIR, `${id}.csv`);
}

/** Write CSV to disk for Java/Maven consumption. Returns absolute file path. */
export async function materializeScriptCsv(id) {
  ensureDirs();
  const script = await getScriptMeta(id);
  if (!script) return null;
  const { rows } = await query(
    `SELECT data FROM script_rows WHERE script_id = $1 ORDER BY row_index ASC`,
    [id],
  );
  const loadConfirm = (value) => {
    const v = String(value ?? '').trim();
    if (!v || /^NA$/i.test(v) || /^N\/A$/i.test(v)) return 'body';
    return v;
  };
  const filePath = materializePath(id, script.type);
  if (script.type === 'static') {
    const header = 'Transaction Name,Path Page URL,Element Identifier,Element Selector\n';
    const body = rows.map((r) => {
      const d = r.data;
      const waitSel = loadConfirm(d.elementSelector);
      const strategy = d.elementIdentifier
        || (String(waitSel).startsWith('//') ? 'XPath' : 'CSS');
      return toCsvRow([d.transactionName, d.pageUrl, strategy, waitSel]);
    }).join('\n');
    fs.writeFileSync(filePath, header + body + (body ? '\n' : ''));
  } else {
    const header = 'Test_Case_Name,Transaction_Name,Test_Steps,Object_Name,Request,Selector,Locator,Action,Parameter,Element to Wait,Element identifier,Frame_Selector\n';
    const body = upgradeScriptedRows(rows.map((r) => r.data)).map((d) => {
      const waitSel = loadConfirm(d.elementIdentifier || d.selector);
      const waitStrategy = d.elementToWait
        ?? d.locator
        ?? (String(waitSel).startsWith('//') ? 'Xpath' : 'CSS');
      return toCsvRow([
        d.testCaseName, d.transactionName, d.testStep, d.objectName ?? '',
        d.request, d.selector, d.locator ?? 'Xpath', d.action, d.parameter,
        waitStrategy, waitSel, d.frameSelector ?? '',
      ]);
    }).join('\n');
    fs.writeFileSync(filePath, header + body + (body ? '\n' : ''));
  }
  return filePath;
}

async function getScriptMeta(id) {
  const { rows } = await query('SELECT * FROM scripts WHERE id = $1', [id]);
  return rows[0] ? mapScript(rows[0]) : null;
}

export async function listScripts(type) {
  await ensureScriptNumbers();
  const select = `SELECT s.*, jsonb_array_length(d.rows) AS data_rows
    FROM scripts s LEFT JOIN script_data d ON d.script_id = s.id`;
  const order = 'ORDER BY s.script_number ASC NULLS LAST, s.updated_at DESC';
  const { rows } = type
    ? await query(`${select} WHERE s.type = $1 ${order}`, [type])
    : await query(`${select} ${order}`);
  return rows.map(mapScript);
}

export async function getScript(id) {
  const meta = await getScriptMeta(id);
  if (!meta) return null;
  const { rows } = await query(
    `SELECT data FROM script_rows WHERE script_id = $1 ORDER BY row_index ASC`,
    [id],
  );
  const dataRows = meta.type === 'scripted'
    ? upgradeScriptedRows(rows.map((r) => r.data))
    : rows.map((r) => r.data);
  const filePath = await materializeScriptCsv(id);
  const stepCount = meta.type === 'static'
    ? countUrlsInCsvFile(filePath, fs)
    : countRowsInCsvFile(filePath, fs);

  let headers;
  if (meta.type === 'static') {
    headers = ['Transaction Name', 'Path Page URL', 'Element Identifier', 'Element Selector'];
  } else {
    headers = ['Test_Case_Name', 'Transaction_Name', 'Test_Steps', 'Object_Name', 'Request', 'Selector', 'Locator', 'Action', 'Parameter', 'Element to Wait', 'Element identifier', 'Frame_Selector'];
  }

  // Convert to CSV-shaped rows for API compatibility with existing UI
  const csvShaped = dataRows.map((d) => {
    if (meta.type === 'static') {
      return {
        'Transaction Name': d.transactionName ?? '',
        'Path Page URL': d.pageUrl ?? '',
        'Element Identifier': d.elementIdentifier ?? '',
        'Element Selector': d.elementSelector ?? '',
        ...d,
      };
    }
    return {
      Test_Case_Name: d.testCaseName ?? '',
      Transaction_Name: d.transactionName ?? '',
      Test_Steps: d.testStep ?? '',
      Object_Name: d.objectName ?? '',
      Request: d.request ?? '',
      Selector: d.selector ?? '',
      Locator: d.locator ?? 'Xpath',
      Action: d.action ?? '',
      Parameter: d.parameter ?? '',
      'Element to Wait': d.elementToWait ?? 'Xpath',
      'Element identifier': d.elementIdentifier ?? '',
      Frame_Selector: d.frameSelector ?? '',
      ...d,
    };
  });

  return {
    ...meta,
    filePath,
    headers,
    rows: csvShaped,
    stepCount,
    urlCount: stepCount,
  };
}

export async function saveScript({ id, name, type, description, rows, source, crawlRunId }) {
  ensureDirs();
  const scriptId = id || `script_${Date.now()}`;
  const now = new Date().toISOString();
  const normalizedRows = type === 'scripted'
    ? upgradeScriptedRows(rows ?? []).map((row) => {
        const request = String(row?.request ?? '').trim();
        const action = row?.action ?? '';
        const isServer = request.length > 0 || action === 'Navigate' || action === 'CalculateFullPageLoadTime';
        if (isServer) return row;
        return { ...row, transactionName: '' };
      })
    : (rows ?? []);

  await withClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(
        `INSERT INTO scripts (id, name, type, source, crawl_run_id, description, step_count, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           type = EXCLUDED.type,
           source = EXCLUDED.source,
           crawl_run_id = EXCLUDED.crawl_run_id,
           description = EXCLUDED.description,
           step_count = EXCLUDED.step_count,
           updated_at = EXCLUDED.updated_at`,
        [scriptId, name, type, source ?? 'studio', crawlRunId ?? null, description ?? '', normalizedRows.length, now],
      );
      await client.query('DELETE FROM script_rows WHERE script_id = $1', [scriptId]);
      for (let i = 0; i < normalizedRows.length; i++) {
        await client.query(
          `INSERT INTO script_rows (script_id, row_index, data) VALUES ($1, $2, $3)`,
          [scriptId, i, JSON.stringify(normalizedRows[i])],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });

  await materializeScriptCsv(scriptId);
  return getScriptMeta(scriptId);
}

export async function importCrawledScript(crawlRunId, name, csvPath) {
  ensureDirs();
  const scriptId = `crawl_${crawlRunId}`;
  let rows = [];
  if (fs.existsSync(csvPath)) {
    const { data } = parseCsvFile(csvPath, fs);
    rows = data.map((r) => ({
      transactionName: r['Transaction Name'] ?? '',
      pageUrl: r['Path Page URL'] ?? '',
      elementIdentifier: r['Element Identifier'] ?? 'NA',
      elementSelector: r['Element Selector'] ?? 'NA',
    }));
  }
  return saveScript({
    id: scriptId,
    name: name || `Crawled URLs (Run ${crawlRunId})`,
    type: 'static',
    source: 'crawled',
    crawlRunId,
    description: `Imported from crawled_urls_${crawlRunId}.csv`,
    rows,
  });
}

export async function importLegacyStaticFromFile(staticCsvPath) {
  if (!fs.existsSync(staticCsvPath)) return null;
  const { data } = parseCsvFile(staticCsvPath, fs);
  const rows = data.map((r) => ({
    transactionName: r['Transaction Name'] ?? '',
    pageUrl: r['Path Page URL'] ?? '',
    elementIdentifier: r['Element Identifier'] ?? '',
    elementSelector: r['Element Selector'] ?? '',
  }));
  return saveScript({
    id: 'legacy_static',
    name: 'Legacy Static Test Cases',
    type: 'static',
    source: 'legacy',
    description: `Synced from ${path.basename(staticCsvPath)}`,
    rows,
  });
}

export async function importLegacyScriptedFromFile(scriptedCsvPath) {
  if (!fs.existsSync(scriptedCsvPath)) return null;
  const { data } = parseCsvFile(scriptedCsvPath, fs);
  const rows = data.map((r) => ({
    testCaseName: r.Test_Case_Name ?? '',
    transactionName: r.Transaction_Name ?? '',
    testStep: r.Test_Steps ?? '',
    objectName: r.Object_Name ?? '',
    request: r.Request ?? '',
    selector: r.Selector ?? '',
    locator: r.Locator ?? 'Xpath',
    action: r.Action ?? '',
    parameter: r.Parameter ?? '',
    elementToWait: r['Element to Wait'] ?? 'Xpath',
    elementIdentifier: r['Element identifier'] ?? '',
    frameSelector: r.Frame_Selector ?? '',
  }));
  return saveScript({
    id: 'legacy_scripted',
    name: 'Legacy Scripted Flow',
    type: 'scripted',
    source: 'legacy',
    description: `Synced from ${path.basename(scriptedCsvPath)}`,
    rows,
  });
}

export async function syncLegacyScripts({ staticCsv, scriptedCsv, resultsDir }) {
  const synced = [];
  const staticScript = await importLegacyStaticFromFile(staticCsv);
  if (staticScript) synced.push(staticScript);
  const scriptedScript = await importLegacyScriptedFromFile(scriptedCsv);
  if (scriptedScript) synced.push(scriptedScript);
  if (resultsDir && fs.existsSync(resultsDir)) {
    for (const file of fs.readdirSync(resultsDir)) {
      const m = file.match(/^crawled_urls_(\d{4})\.csv$/);
      if (!m) continue;
      synced.push(await importCrawledScript(m[1], `Crawled URLs (Run ${m[1]})`, path.join(resultsDir, file)));
    }
  }
  return synced;
}

export async function deleteScript(id) {
  const meta = await getScriptMeta(id);
  if (!meta) return false;
  await query('DELETE FROM scripts WHERE id = $1', [id]);
  const filePath = materializePath(id, meta.type);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  const dataPath = dataFilePath(id);
  if (fs.existsSync(dataPath)) fs.unlinkSync(dataPath);
  return true;
}

// ── Test data (CSV) for data-driven scripted scripts ───────────

/** How each flow iteration picks its data row. */
export const DATA_MODES = ['sequential', 'random', 'unique'];
const MAX_DATA_ROWS = 50000;

export async function ensureScriptDataTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS script_data (
      script_id TEXT PRIMARY KEY REFERENCES scripts(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL DEFAULT '',
      headers JSONB NOT NULL DEFAULT '[]',
      rows JSONB NOT NULL DEFAULT '[]',
      mode TEXT NOT NULL DEFAULT 'sequential',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function dataFilePath(id) {
  return path.join(DATA_DIR, `${id}.csv`);
}

/** Parse uploaded CSV text into headers + rows; throws a readable error when unusable. */
export function parseDataCsv(text) {
  const all = parseCsvAllRows(String(text ?? '').replace(/^\uFEFF/, ''));
  if (!all.length) throw new Error('The CSV file is empty');
  const headers = all[0].map((h) => String(h).trim());
  if (headers.some((h) => !h)) throw new Error('Every column in the header row needs a name');
  const bad = headers.find((h) => !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(h));
  if (bad) throw new Error(`Column "${bad}" can only use letters, digits, _ . - so it can be used as \${${bad}} in steps`);
  const dupe = headers.find((h, i) => headers.indexOf(h) !== i);
  if (dupe) throw new Error(`Column "${dupe}" appears twice`);
  const rows = all.slice(1).map((cells) => headers.map((_, i) => String(cells[i] ?? '')));
  if (!rows.length) throw new Error('The CSV has a header row but no data rows');
  if (rows.length > MAX_DATA_ROWS) throw new Error(`Too many rows (max ${MAX_DATA_ROWS})`);
  return { headers, rows };
}

export async function getScriptData(id) {
  const { rows } = await query('SELECT * FROM script_data WHERE script_id = $1', [id]);
  const r = rows[0];
  if (!r) return null;
  return {
    scriptId: id,
    fileName: r.file_name,
    headers: r.headers,
    rows: r.rows,
    rowCount: r.rows.length,
    mode: r.mode,
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
  };
}

export async function saveScriptData(id, { headers, rows, mode, fileName }) {
  const m = DATA_MODES.includes(mode) ? mode : 'sequential';
  await query(
    `INSERT INTO script_data (script_id, file_name, headers, rows, mode, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (script_id) DO UPDATE SET
       file_name = EXCLUDED.file_name, headers = EXCLUDED.headers, rows = EXCLUDED.rows,
       mode = EXCLUDED.mode, updated_at = NOW()`,
    [id, fileName ?? '', JSON.stringify(headers), JSON.stringify(rows), m],
  );
  await materializeScriptData(id);
  return getScriptData(id);
}

export async function setScriptDataMode(id, mode) {
  if (!DATA_MODES.includes(mode)) throw new Error(`Mode must be one of ${DATA_MODES.join(', ')}`);
  await query('UPDATE script_data SET mode = $2, updated_at = NOW() WHERE script_id = $1', [id, mode]);
  return getScriptData(id);
}

export async function deleteScriptData(id) {
  await query('DELETE FROM script_data WHERE script_id = $1', [id]);
  const p = dataFilePath(id);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

/** Write the data CSV for the engine. Returns { filePath, mode } or null when the script has no data. */
export async function materializeScriptData(id) {
  ensureDirs();
  const data = await getScriptData(id);
  const p = dataFilePath(id);
  if (!data) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
    return null;
  }
  const lines = [toCsvRow(data.headers), ...data.rows.map((r) => toCsvRow(r))];
  fs.writeFileSync(p, lines.join('\n') + '\n');
  return { filePath: p, mode: data.mode, rowCount: data.rowCount };
}

export async function renameScript(id, name) {
  const trimmed = (name ?? '').trim();
  if (!trimmed) throw new Error('Script name is required');
  const { rows } = await query(
    `UPDATE scripts SET name = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id, trimmed],
  );
  return rows[0] ? mapScript(rows[0]) : null;
}
