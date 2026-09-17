import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseCsvContent, parseCsvFile, toCsvRow, countUrlsInCsvFile, countRowsInCsvFile } from './csvUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.join(__dirname, '../data/scripts');
const STATIC_DIR = path.join(SCRIPTS_DIR, 'static');
const SCRIPTED_DIR = path.join(SCRIPTS_DIR, 'scripted');
const META_FILE = path.join(SCRIPTS_DIR, 'index.json');

function ensureDirs() {
  [SCRIPTS_DIR, STATIC_DIR, SCRIPTED_DIR].forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
  if (!fs.existsSync(META_FILE)) {
    fs.writeFileSync(META_FILE, JSON.stringify({ scripts: [] }, null, 2));
  }
}

function readMeta() {
  ensureDirs();
  return JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
}

function writeMeta(meta) {
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2));
}

function upsertMetaEntry(entry) {
  const meta = readMeta();
  const idx = meta.scripts.findIndex((s) => s.id === entry.id);
  if (idx >= 0) meta.scripts[idx] = entry;
  else meta.scripts.unshift(entry);
  writeMeta(meta);
  return entry;
}

export function listScripts(type) {
  const meta = readMeta();
  return type ? meta.scripts.filter((s) => s.type === type) : meta.scripts;
}

export function getScript(id) {
  const meta = readMeta();
  const script = meta.scripts.find((s) => s.id === id);
  if (!script) return null;

  const filePath = script.filePath || path.join(
    script.type === 'static' ? STATIC_DIR : SCRIPTED_DIR,
    `${id}.csv`,
  );
  const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const { headers, data } = parseCsvContent(content);
  const stepCount = script.type === 'static'
    ? countUrlsInCsvFile(filePath, fs)
    : countRowsInCsvFile(filePath, fs);
  return { ...script, headers, rows: data, filePath, stepCount, urlCount: stepCount };
}

export function saveScript({ id, name, type, description, rows, source, crawlRunId }) {
  ensureDirs();
  const scriptId = id || `script_${Date.now()}`;
  const dir = type === 'static' ? STATIC_DIR : SCRIPTED_DIR;
  const filePath = path.join(dir, `${scriptId}.csv`);

  if (type === 'static') {
    const header = 'Transaction Name,Path Page URL,Element Identifier,Element Selector\n';
    const body = rows.map((r) =>
      toCsvRow([r.transactionName, r.pageUrl, r.elementIdentifier, r.elementSelector])
    ).join('\n');
    fs.writeFileSync(filePath, header + body + (body ? '\n' : ''));
  } else {
    const header = 'Test_Case_Name,Transaction_Name,Test_Steps,Object_Name,Request,Selector,Locator,Action,Parameter,Element to Wait,Element identifier,Frame_Selector\n';
    const body = rows.map((r) =>
      toCsvRow([
        r.testCaseName, r.transactionName, r.testStep, r.objectName ?? '',
        r.request, r.selector, r.locator ?? 'Xpath', r.action, r.parameter,
        r.elementToWait ?? 'Xpath', r.elementIdentifier, r.frameSelector ?? '',
      ])
    ).join('\n');
    fs.writeFileSync(filePath, header + body + (body ? '\n' : ''));
  }

  const entry = {
    id: scriptId,
    name,
    type,
    source: source ?? 'studio',
    crawlRunId: crawlRunId ?? null,
    description: description ?? '',
    filePath,
    updatedAt: new Date().toISOString(),
    createdAt: readMeta().scripts.find((s) => s.id === scriptId)?.createdAt ?? new Date().toISOString(),
    stepCount: rows.length,
  };

  upsertMetaEntry(entry);
  return entry;
}

/** Copy an existing CSV file into the script library (crawled URLs). */
export function importCrawledScript(crawlRunId, name, csvPath) {
  ensureDirs();
  const scriptId = `crawl_${crawlRunId}`;
  const dest = path.join(STATIC_DIR, `${scriptId}.csv`);

  if (fs.existsSync(csvPath)) {
    fs.copyFileSync(csvPath, dest);
  }

  const urlCount = countUrlsInCsvFile(dest, fs);
  const entry = {
    id: scriptId,
    name: name || `Crawled URLs (Run ${crawlRunId})`,
    type: 'static',
    source: 'crawled',
    crawlRunId,
    description: `Imported from crawled_urls_${crawlRunId}.csv`,
    filePath: dest,
    updatedAt: new Date().toISOString(),
    createdAt: readMeta().scripts.find((s) => s.id === scriptId)?.createdAt ?? new Date().toISOString(),
    stepCount: urlCount,
  };

  upsertMetaEntry(entry);
  return entry;
}

export function importLegacyStaticFromFile(staticCsvPath) {
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

export function importLegacyScriptedFromFile(scriptedCsvPath) {
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

export function syncLegacyScripts({ staticCsv, scriptedCsv, resultsDir }) {
  const synced = [];

  const staticScript = importLegacyStaticFromFile(staticCsv);
  if (staticScript) synced.push(staticScript);

  const scriptedScript = importLegacyScriptedFromFile(scriptedCsv);
  if (scriptedScript) synced.push(scriptedScript);

  if (resultsDir && fs.existsSync(resultsDir)) {
    for (const file of fs.readdirSync(resultsDir)) {
      const m = file.match(/^crawled_urls_(\d{4})\.csv$/);
      if (!m) continue;
      const crawlRunId = m[1];
      const csvPath = path.join(resultsDir, file);
      synced.push(importCrawledScript(crawlRunId, `Crawled URLs (Run ${crawlRunId})`, csvPath));
    }
  }

  return synced;
}

export function deleteScript(id) {
  const meta = readMeta();
  const script = meta.scripts.find((s) => s.id === id);
  if (!script) return false;
  if (script.filePath && fs.existsSync(script.filePath)) fs.unlinkSync(script.filePath);
  meta.scripts = meta.scripts.filter((s) => s.id !== id);
  writeMeta(meta);
  return true;
}

export function renameScript(id, name) {
  const trimmed = (name ?? '').trim();
  if (!trimmed) {
    throw new Error('Script name is required');
  }
  const meta = readMeta();
  const script = meta.scripts.find((s) => s.id === id);
  if (!script) return null;
  script.name = trimmed;
  script.updatedAt = new Date().toISOString();
  upsertMetaEntry(script);
  return script;
}
