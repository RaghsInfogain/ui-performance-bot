import { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Play, AlertCircle, Search, Globe, FileText, Clapperboard, Scale } from 'lucide-react';
import { PageHeader } from '../components/layout/AppLayout';
import {
  ExecutionSettingsForm, SCRIPT_CATEGORY_LABELS, allocateThreads, defaultExecution, scriptCategory,
  type ScriptCategory,
} from '../components/run/ExecutionSettingsForm';
import { api } from '../services/api';
import type { ExecutionSettings, TestScript } from '../types';

const CATEGORY_ICONS: Record<ScriptCategory, typeof Globe> = {
  crawled: Globe,
  scripted: FileText,
  navigation: Clapperboard,
};

const CATEGORY_BADGE: Record<ScriptCategory, string> = {
  crawled: 'bg-sky-50 text-sky-800 ring-sky-200',
  scripted: 'bg-violet-50 text-violet-800 ring-violet-200',
  navigation: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
};

/** Even integer split of 100% across the given ids; remainder goes to the first ones. */
function evenSplit(ids: string[]): Record<string, number> {
  if (!ids.length) return {};
  const base = Math.floor(100 / ids.length);
  let extra = 100 - base * ids.length;
  const out: Record<string, number> = {};
  for (const id of ids) {
    out[id] = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra -= 1;
  }
  return out;
}

export default function RunTest() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselected = useMemo(
    () => searchParams.getAll('scriptId').flatMap((v) => v.split(',')).filter(Boolean),
    [searchParams],
  );

  const [scripts, setScripts] = useState<TestScript[]>([]);
  const [loadingScripts, setLoadingScripts] = useState(true);
  const [filter, setFilter] = useState<'all' | ScriptCategory>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [loadPercent, setLoadPercent] = useState<Record<string, number>>({});
  const [execution, setExecution] = useState<ExecutionSettings | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getConfig().then((c) => setExecution(defaultExecution(c))).catch(() => {
      setExecution({ browserType: 'chrome', headlessMode: true, testDurationSeconds: 0, multiThreading: 1, thinkTime: 0 });
    });
    api.listScripts()
      .then((list) => {
        setScripts(list);
        const initial = preselected.filter((id) => list.some((s) => s.id === id));
        if (initial.length) {
          setSelected(initial);
          setLoadPercent(evenSplit(initial));
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load scripts'))
      .finally(() => setLoadingScripts(false));
  }, [preselected]);

  const counts = useMemo(() => {
    const c: Record<ScriptCategory, number> = { crawled: 0, scripted: 0, navigation: 0 };
    for (const s of scripts) c[scriptCategory(s)] += 1;
    return c;
  }, [scripts]);

  const visibleScripts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scripts.filter((s) => (
      (filter === 'all' || scriptCategory(s) === filter)
      && (!q || s.name.toLowerCase().includes(q) || String(s.scriptNumber ?? '').includes(q))
    ));
  }, [scripts, filter, search]);

  const selectedScripts = selected
    .map((id) => scripts.find((s) => s.id === id))
    .filter((s): s is TestScript => Boolean(s));
  const isMulti = selectedScripts.length > 1;
  const percents = selectedScripts.map((s) => (isMulti ? loadPercent[s.id] ?? 0 : 100));
  const percentTotal = percents.reduce((a, b) => a + b, 0);
  const percentValid = !isMulti || (percentTotal === 100 && percents.every((p) => p > 0));
  const threadShares = execution && selectedScripts.length
    ? allocateThreads(execution.multiThreading, percents)
    : [];
  const effectiveThreads = threadShares.reduce((a, b) => a + b, 0);

  const toggleScript = (id: string) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    setSelected(next);
    setLoadPercent(evenSplit(next));
  };

  const handleStart = async () => {
    if (!execution || !selectedScripts.length || !percentValid) return;
    setError('');
    setStarting(true);
    try {
      const result = await api.startBatchRun({
        scripts: selectedScripts.map((s, i) => ({ scriptId: s.id, loadPercent: percents[i] })),
        execution,
      });
      if (result.runs.length === 1) navigate(`/app/runs/${result.runs[0].runId}`);
      else navigate('/app/runs', { state: { batch: result } });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start run. Ensure API server (npm run server) and Maven/Java are installed.');
    } finally {
      setStarting(false);
    }
  };

  const filterTabs: { key: 'all' | ScriptCategory; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: scripts.length },
    { key: 'crawled', label: SCRIPT_CATEGORY_LABELS.crawled, count: counts.crawled },
    { key: 'scripted', label: SCRIPT_CATEGORY_LABELS.scripted, count: counts.scripted },
    { key: 'navigation', label: SCRIPT_CATEGORY_LABELS.navigation, count: counts.navigation },
  ];

  return (
    <>
      <PageHeader
        title="Run Test"
        subtitle="Select one or more scripts, configure execution, and launch the Java Playwright engine"
      />

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 p-4 text-sm text-red-800">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      <div className="mx-auto max-w-3xl space-y-6">
        <section className="card">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-lg font-semibold">1. Select Script(s)</h3>
            <span className="text-sm text-slate-500">{selectedScripts.length} selected</span>
          </div>

          <div className="mb-3 flex flex-wrap gap-2">
            {filterTabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setFilter(t.key)}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${filter === t.key ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'}`}
              >
                {t.label} <span className="opacity-70">({t.count})</span>
              </button>
            ))}
          </div>

          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input-field pl-9"
              placeholder="Search by name or Script ID"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {loadingScripts ? (
            <p className="p-4 text-center text-sm text-slate-400">Loading scripts…</p>
          ) : scripts.length === 0 ? (
            <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
              No scripts saved yet. Create one from{' '}
              <Link to="/app/scripts" className="font-semibold text-brand-600 underline">Scripts</Link>
              {' '}or the{' '}
              <Link to="/app/crawler" className="font-semibold text-brand-600 underline">Website Crawler</Link>.
            </div>
          ) : visibleScripts.length === 0 ? (
            <p className="p-4 text-center text-sm text-slate-400">No scripts match this filter.</p>
          ) : (
            <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
              {visibleScripts.map((s) => {
                const cat = scriptCategory(s);
                const Icon = CATEGORY_ICONS[cat];
                const checked = selected.includes(s.id);
                return (
                  <li key={s.id}>
                    <label className={`flex cursor-pointer items-center gap-3 px-4 py-3 ${checked ? 'bg-brand-50' : 'hover:bg-slate-50'}`}>
                      <input type="checkbox" className="h-4 w-4" checked={checked} onChange={() => toggleScript(s.id)} />
                      <Icon className="h-4 w-4 shrink-0 text-slate-400" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium" title={s.name}>
                          {s.scriptNumber != null && <span className="mr-1 font-mono text-xs text-slate-400">#{s.scriptNumber}</span>}
                          {s.name}
                        </div>
                        <div className="text-xs text-slate-500">
                          {s.stepCount} {s.type === 'static' ? 'URLs' : 'steps'}
                          {s.testDataRows ? ` · ${s.testDataRows} test data row${s.testDataRows === 1 ? '' : 's'}` : ''}
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${CATEGORY_BADGE[cat]}`}>
                        {SCRIPT_CATEGORY_LABELS[cat]}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="card">
          <h3 className="mb-4 font-display text-lg font-semibold">2. Execution Settings</h3>
          {execution && <ExecutionSettingsForm value={execution} onChange={setExecution} />}
        </section>

        {isMulti && execution && (
          <section className="card">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-lg font-semibold">3. Load Distribution</h3>
              <button type="button" className="btn-secondary text-sm" onClick={() => setLoadPercent(evenSplit(selected))}>
                <Scale className="h-4 w-4" /> Distribute evenly
              </button>
            </div>
            <p className="mb-3 text-xs text-slate-500">
              Load % sets each script's share of the {execution.multiThreading} total thread{execution.multiThreading === 1 ? '' : 's'}.
              Scripts run concurrently, each in its own engine.
            </p>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-400">
                  <tr>
                    <th className="px-4 py-2">Script</th>
                    <th className="w-28 px-4 py-2">Load %</th>
                    <th className="w-20 px-4 py-2 text-right">Threads</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedScripts.map((s, i) => (
                    <tr key={s.id} className="border-t border-slate-100">
                      <td className="px-4 py-2">
                        <div className="truncate font-medium" title={s.name}>{s.name}</div>
                        <div className="text-xs text-slate-500">{SCRIPT_CATEGORY_LABELS[scriptCategory(s)]}</div>
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="number"
                          min={1}
                          max={100}
                          className="input-field py-1"
                          aria-label={`Load % for ${s.name}`}
                          value={loadPercent[s.id] ?? 0}
                          onChange={(e) => setLoadPercent({ ...loadPercent, [s.id]: Math.max(0, Math.min(100, Math.floor(Number(e.target.value) || 0))) })}
                        />
                      </td>
                      <td className="px-4 py-2 text-right font-mono">{threadShares[i]}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-slate-200 bg-slate-50 text-sm font-semibold">
                  <tr>
                    <td className="px-4 py-2">Total</td>
                    <td className={`px-4 py-2 ${percentTotal === 100 ? 'text-emerald-700' : 'text-red-600'}`}>{percentTotal}%</td>
                    <td className="px-4 py-2 text-right font-mono">{effectiveThreads}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {percentTotal !== 100 && (
              <p className="mt-2 text-xs text-red-600">Load % must add up to 100.</p>
            )}
            {percents.some((p) => p <= 0) && (
              <p className="mt-2 text-xs text-red-600">Every selected script needs a Load % above 0.</p>
            )}
            {effectiveThreads > execution.multiThreading && (
              <p className="mt-2 text-xs text-amber-700">
                Each script needs at least 1 thread, so {effectiveThreads} threads will run instead of {execution.multiThreading}.
              </p>
            )}
          </section>
        )}

        <button
          onClick={handleStart}
          disabled={starting || !execution || !selectedScripts.length || !percentValid}
          className="btn-primary w-full justify-center py-3 text-base"
        >
          <Play className="h-5 w-5" />
          {starting
            ? 'Starting Java engine…'
            : isMulti ? `Start ${selectedScripts.length} Scripts` : 'Start Test Run'}
        </button>
      </div>
    </>
  );
}
