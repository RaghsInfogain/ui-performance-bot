/**
 * One-time / startup migration from filesystem → PostgreSQL.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initSchema, query, getSetting, setSetting } from './pool.js';
import { signup } from '../authStore.js';
import { syncLegacyScripts, saveScript } from '../scriptsStore.js';
import { writeConfig, readConfig } from '../configStore.js';
import { upsertRun } from '../runsStore.js';
import { parseCsvFile } from '../csvUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORTAL_ROOT = path.resolve(__dirname, '../..');
const WORKSPACE_ROOT = path.resolve(PORTAL_ROOT, '..');
const DATA_DIR = path.join(PORTAL_ROOT, 'data');
const RESULTS_DIR = path.join(WORKSPACE_ROOT, 'Results');
const CONFIG_CSV = path.join(WORKSPACE_ROOT, 'config.csv');
const STATIC_CSV = path.join(WORKSPACE_ROOT, 'StaticTestCases.csv');
const SCRIPTED_CSV = path.join(WORKSPACE_ROOT, 'ScriptedTestCasesFilePath.csv');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SCRIPTS_META = path.join(DATA_DIR, 'scripts', 'index.json');

function parseConfigCsv(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf(',');
    if (i < 0) continue;
    raw[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return raw;
}

async function migrateUsers() {
  if (!fs.existsSync(USERS_FILE)) {
    // Seed demo user if empty
    const { rows } = await query('SELECT COUNT(*)::int AS c FROM users');
    if (rows[0].c === 0) {
      try {
        await signup({
          name: 'Demo User',
          email: 'demo@tenarai.com',
          password: 'demo1234',
          company: 'Tenarai',
        });
        console.log('[db] Seeded demo user demo@tenarai.com / demo1234');
      } catch (err) {
        console.warn('[db] Demo user seed skipped:', err.message);
      }
    }
    return;
  }
  const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  for (const u of data.users ?? []) {
    await query(
      `INSERT INTO users (id, name, email, company, salt, password_hash, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (email) DO NOTHING`,
      [u.id, u.name, u.email, u.company ?? '', u.salt, u.hash, u.createdAt ?? new Date().toISOString()],
    );
  }
  console.log(`[db] Migrated ${(data.users ?? []).length} users from users.json`);
}

async function migrateConfig() {
  const existing = await readConfig();
  const { rows } = await query('SELECT COUNT(*)::int AS c FROM app_config');
  if (rows[0].c > 0) return;
  const fromFile = parseConfigCsv(CONFIG_CSV);
  if (fromFile) {
    await writeConfig({ ...existing, ...fromFile });
    console.log('[db] Migrated config.csv → app_config');
  } else {
    await writeConfig(existing);
    console.log('[db] Seeded default app_config');
  }
}

async function migrateScriptsFromIndex() {
  if (!fs.existsSync(SCRIPTS_META)) return;
  const meta = JSON.parse(fs.readFileSync(SCRIPTS_META, 'utf8'));
  for (const s of meta.scripts ?? []) {
    const csvPath = s.filePath;
    if (!csvPath || !fs.existsSync(csvPath)) continue;
    const { data } = parseCsvFile(csvPath, fs);
    if (s.type === 'static') {
      const rows = data.map((r) => ({
        transactionName: r['Transaction Name'] ?? '',
        pageUrl: r['Path Page URL'] ?? '',
        elementIdentifier: r['Element Identifier'] ?? '',
        elementSelector: r['Element Selector'] ?? '',
      }));
      await saveScript({
        id: s.id,
        name: s.name,
        type: 'static',
        source: s.source,
        crawlRunId: s.crawlRunId,
        description: s.description,
        rows,
      });
    } else {
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
      await saveScript({
        id: s.id,
        name: s.name,
        type: 'scripted',
        source: s.source,
        description: s.description,
        rows,
      });
    }
  }
  console.log(`[db] Migrated scripts from index.json`);
}

async function migrateRunMeta() {
  if (!fs.existsSync(RESULTS_DIR)) return;
  let count = 0;
  for (const d of fs.readdirSync(RESULTS_DIR, { withFileTypes: true })) {
    if (!d.isDirectory() || !d.name.startsWith('Static_RunID_')) continue;
    const runId = d.name.replace('Static_RunID_', '');
    const metaPath = path.join(RESULTS_DIR, d.name, 'run-meta.json');
    if (!fs.existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      await upsertRun({
        runId,
        mode: meta.mode ?? 'static',
        status: meta.status ?? 'completed',
        startedAt: meta.startedAt,
        endedAt: meta.endedAt,
        hostname: meta.hostname,
        configSnapshot: meta.configSnapshot ?? {},
        testDurationSeconds: meta.testDurationSeconds,
        multiThreading: meta.multiThreading ?? 1,
        urlsTotal: meta.urlsTotal ?? 0,
        scriptId: meta.scriptId,
        crawlRunId: meta.crawlRunId,
        exitCode: meta.exitCode,
      });
      count += 1;
    } catch {
      /* skip bad meta */
    }
  }
  console.log(`[db] Migrated ${count} run-meta.json → runs`);
}

export async function migrateFromFilesystem() {
  await initSchema();
  const done = await getSetting('fs_migrated');
  if (done === '1') {
    console.log('[db] Schema ready (migration already applied)');
    return;
  }

  console.log('[db] Running filesystem → PostgreSQL migration…');
  await migrateUsers();
  await migrateConfig();
  await migrateScriptsFromIndex();
  await syncLegacyScripts({
    staticCsv: STATIC_CSV,
    scriptedCsv: SCRIPTED_CSV,
    resultsDir: RESULTS_DIR,
  });
  await migrateRunMeta();
  await setSetting('fs_migrated', '1');
  console.log('[db] Migration complete');
}
