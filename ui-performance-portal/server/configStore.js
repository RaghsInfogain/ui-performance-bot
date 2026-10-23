import fs from 'fs';
import { query } from './db/pool.js';

const DEFAULTS = {
  Headless_Mode: 'TRUE',
  BrowserType: 'chrome',
  Test_Duration_Seconds: '0',
  TakeScreenshot: 'FALSE',
  ScriptedFlow: 'FALSE',
  UserExperience: 'TRUE',
  AutoCrawl: 'FALSE',
  Think_Time: '0',
  Multi_Threading: '1',
  CrawlerURL: '',
};

export async function readConfig() {
  const { rows } = await query('SELECT key, value FROM app_config');
  if (!rows.length) return { ...DEFAULTS };
  const raw = { ...DEFAULTS };
  for (const r of rows) raw[r.key] = r.value;
  return raw;
}

export async function writeConfig(raw) {
  const entries = Object.entries(raw);
  for (const [key, value] of entries) {
    await query(
      `INSERT INTO app_config (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, String(value ?? '')],
    );
  }
}

/** Export config.csv for Java ConfigurationManager. */
export async function materializeConfigCsv(csvPath) {
  const raw = await readConfig();
  const lines = Object.entries(raw).map(([k, v]) => `${k},${v}`);
  fs.writeFileSync(csvPath, lines.join('\n') + '\n');
  return raw;
}

export function configToApi(raw) {
  const durationRaw = raw.Test_Duration_Seconds;
  return {
    headlessMode: String(raw.Headless_Mode).toUpperCase() === 'TRUE',
    browserType: (raw.BrowserType || 'chrome').toLowerCase(),
    testDurationSeconds: durationRaw && durationRaw !== '0' && durationRaw !== 'NA'
      ? Number(durationRaw)
      : null,
    takeScreenshot: String(raw.TakeScreenshot).toUpperCase() === 'TRUE',
    scriptedFlow: String(raw.ScriptedFlow).toUpperCase() === 'TRUE',
    userExperience: String(raw.UserExperience).toUpperCase() === 'TRUE',
    autoCrawl: String(raw.AutoCrawl).toUpperCase() === 'TRUE',
    thinkTime: Number(raw.Think_Time) || 0,
    multiThreading: Number(raw.Multi_Threading) || 1,
    crawlerUrl: raw.CrawlerURL || '',
    resultDirectory: '../Results',
    screenshotDirectory: '../screenshots',
  };
}

export function apiToConfig(api) {
  return {
    Headless_Mode: api.headlessMode ? 'TRUE' : 'FALSE',
    BrowserType: api.browserType || 'chrome',
    Test_Duration_Seconds: String(api.testDurationSeconds ?? 0),
    TakeScreenshot: api.takeScreenshot ? 'TRUE' : 'FALSE',
    ScriptedFlow: api.scriptedFlow ? 'TRUE' : 'FALSE',
    UserExperience: api.userExperience ? 'TRUE' : 'FALSE',
    AutoCrawl: api.autoCrawl ? 'TRUE' : 'FALSE',
    Think_Time: String(api.thinkTime ?? 0),
    Multi_Threading: String(api.multiThreading ?? 1),
    CrawlerURL: api.crawlerUrl || '',
  };
}
