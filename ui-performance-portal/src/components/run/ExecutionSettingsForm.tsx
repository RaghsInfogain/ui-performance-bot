import type { AppConfig, BrowserType, ExecutionSettings, TestScript } from '../../types';

export type ScriptCategory = 'crawled' | 'scripted' | 'navigation';

export const SCRIPT_CATEGORY_LABELS: Record<ScriptCategory, string> = {
  crawled: 'Crawled Session',
  scripted: 'Scripted Flow',
  navigation: 'Navigation Flow',
};

export function scriptCategory(script: TestScript): ScriptCategory {
  if (script.source === 'crawled') return 'crawled';
  if (script.type === 'scripted') return 'scripted';
  return 'navigation';
}

export function defaultExecution(c: AppConfig): ExecutionSettings {
  return {
    browserType: c.browserType,
    headlessMode: c.headlessMode,
    testDurationSeconds: c.testDurationSeconds ?? 0,
    multiThreading: Math.max(1, c.multiThreading),
    thinkTime: c.thinkTime,
  };
}

/** Split total threads by load % (largest remainder, min 1 each) — mirrors the server allocation. */
export function allocateThreads(totalThreads: number, percents: number[]): number[] {
  const total = Math.max(1, Math.floor(totalThreads));
  const sum = percents.reduce((a, b) => a + b, 0) || 1;
  const exact = percents.map((p) => (total * p) / sum);
  const alloc = exact.map((x) => Math.floor(x));
  let remaining = total - alloc.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (remaining <= 0) break;
    alloc[i] += 1;
    remaining -= 1;
  }
  return alloc.map((n) => Math.max(1, n));
}

export function ExecutionSettingsForm({
  value,
  onChange,
  idPrefix = 'exec',
}: {
  value: ExecutionSettings;
  onChange: (next: ExecutionSettings) => void;
  idPrefix?: string;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label className="label" htmlFor={`${idPrefix}-browserType`}>Browser Type</label>
        <select
          id={`${idPrefix}-browserType`}
          className="input-field"
          value={value.browserType}
          onChange={(e) => onChange({ ...value, browserType: e.target.value as BrowserType })}
        >
          <option value="chrome">Chrome (Chromium)</option>
          <option value="firefox">Firefox</option>
          <option value="webkit">WebKit (Safari)</option>
        </select>
      </div>
      <div>
        <label className="label" htmlFor={`${idPrefix}-multiThreading`}>Multi-threading (total threads)</label>
        <input
          id={`${idPrefix}-multiThreading`}
          type="number"
          min={1}
          className="input-field"
          value={value.multiThreading}
          onChange={(e) => onChange({ ...value, multiThreading: Math.max(1, Number(e.target.value) || 1) })}
        />
        <p className="mt-1 text-xs text-slate-400">Parallel browser sessions (virtual users)</p>
      </div>
      <div>
        <label className="label" htmlFor={`${idPrefix}-testDuration`}>Test Duration (seconds)</label>
        <input
          id={`${idPrefix}-testDuration`}
          type="number"
          min={0}
          className="input-field"
          value={value.testDurationSeconds}
          onChange={(e) => onChange({ ...value, testDurationSeconds: Math.max(0, Number(e.target.value) || 0) })}
        />
        <p className="mt-1 text-xs text-slate-400">0 = run once through all requests; &gt;0 = loop until time expires</p>
      </div>
      <div>
        <label className="label" htmlFor={`${idPrefix}-thinkTime`}>Think-Time (ms)</label>
        <input
          id={`${idPrefix}-thinkTime`}
          type="number"
          min={0}
          className="input-field"
          value={value.thinkTime}
          onChange={(e) => onChange({ ...value, thinkTime: Math.max(0, Number(e.target.value) || 0) })}
        />
        <p className="mt-1 text-xs text-slate-400">Wait between each request / step</p>
      </div>
      <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 p-4 sm:col-span-2">
        <input
          type="checkbox"
          checked={value.headlessMode}
          onChange={(e) => onChange({ ...value, headlessMode: e.target.checked })}
          className="h-4 w-4"
        />
        <div>
          <div className="font-medium">Headless Mode</div>
          <p className="text-xs text-slate-500">Run browsers without a visible window</p>
        </div>
      </label>
    </div>
  );
}
