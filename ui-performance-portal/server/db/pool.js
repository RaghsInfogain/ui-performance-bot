import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://uiperf:uiperf123@localhost:5432/uiperformancebot';

export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 20,
});

export async function query(text, params) {
  return pool.query(text, params);
}

export async function withClient(fn) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function initSchema() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  // Split on semicolons so a single privilege/duplicate error does not abort startup
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .map((s) => s.replace(/^--[^\n]*\n?/gm, '').trim())
    .filter((s) => s.length > 0);
  for (const statement of statements) {
    try {
      await pool.query(statement);
    } catch (err) {
      const code = err?.code;
      // 42P07 duplicate_table, 42710 duplicate_object, 42501 insufficient_privilege
      if (code === '42P07' || code === '42710' || code === '42P16' || code === '42501') {
        continue;
      }
      throw err;
    }
  }
}

export async function getSetting(key, fallback = null) {
  const { rows } = await query('SELECT value FROM app_settings WHERE key = $1', [key]);
  return rows[0]?.value ?? fallback;
}

export async function setSetting(key, value) {
  await query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, String(value)],
  );
}
