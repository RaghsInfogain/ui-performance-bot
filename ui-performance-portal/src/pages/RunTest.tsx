import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Play, Globe, FileText, Zap, AlertCircle, Clapperboard } from 'lucide-react';
import { PageHeader } from '../components/layout/AppLayout';
import { api } from '../services/api';
import type { AppConfig, BrowserType, RunMode, TestScript } from '../types';

const defaultExecution = (c: AppConfig) => ({
  browserType: c.browserType,
  headlessMode: c.headlessMode,
  testDurationSeconds: c.testDurationSeconds ?? 0,
  multiThreading: c.multiThreading,
  thinkTime: c.thinkTime,
});

export default function RunTest() {
  const navigate = useNavigate();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [mode, setMode] = useState<RunMode>('static');
  const [testSuite, setTestSuite] = useState<'static' | 'crawled' | 'scripted'>('crawled');
  const [useAutoCrawl, setUseAutoCrawl] = useState(false);
  const [scripts, setScripts] = useState<TestScript[]>([]);
  const [scriptId, setScriptId] = useState('');
  const [dataSource, setDataSource] = useState<'script' | 'legacy'>('script');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [execution, setExecution] = useState<{
    browserType: BrowserType;
    headlessMode: boolean;
    testDurationSeconds: number;
    multiThreading: number;
    thinkTime: number;
  } | null>(null);
  const [urlCountPreview, setUrlCountPreview] = useState<number | null>(null);
  const lastCrawlId = sessionStorage.getItem('lastCrawlRunId');

  useEffect(() => {
    api.getConfig().then((c) => {
      setConfig(c);
      setExecution(defaultExecution(c));
      setMode(c.scriptedFlow ? 'scripted' : 'static');
      setUseAutoCrawl(c.autoCrawl);
      if (lastCrawlId) setTestSuite('crawled');
    });
    api.listScripts().then(setScripts);
  }, [lastCrawlId]);

  useEffect(() => {
    let cancelled = false;
    const loadCount = async () => {
      try {
        if (dataSource === 'script' && scriptId) {
          const script = await api.getScript(scriptId);
          if (!cancelled) setUrlCountPreview(script.stepCount ?? script.rows?.length ?? 0);
        } else if (mode === 'static' && testSuite === 'crawled' && lastCrawlId) {
          const status = await api.getCrawlStatus(lastCrawlId);
          if (!cancelled) setUrlCountPreview(status.urlsFound);
        } else if (mode === 'static' && testSuite === 'static') {
          const script = await api.getScript('legacy_static');
          if (!cancelled) setUrlCountPreview(script?.stepCount ?? null);
        } else {
          if (!cancelled) setUrlCountPreview(null);
        }
      } catch {
        if (!cancelled) setUrlCountPreview(null);
      }
    };
    loadCount();
    return () => { cancelled = true; };
  }, [dataSource, scriptId, mode, testSuite, lastCrawlId]);

  const filteredScripts = scripts.filter((s) => s.type === mode);

  const handleStart = async () => {
    if (!config || !execution) return;
    setError('');
    setStarting(true);
    try {
      const runConfig: AppConfig = {
        ...config,
        browserType: execution.browserType,
        headlessMode: execution.headlessMode,
        testDurationSeconds: execution.testDurationSeconds > 0 ? execution.testDurationSeconds : null,
        multiThreading: Math.max(1, execution.multiThreading),
        thinkTime: Math.max(0, execution.thinkTime),
      };
      const run = await api.startRun({
        mode,
        useAutoCrawl: mode === 'static' && useAutoCrawl && dataSource === 'legacy',
        testSuite: mode === 'scripted' ? 'scripted' : testSuite,
        crawlRunId: dataSource === 'legacy' && testSuite === 'crawled' ? (lastCrawlId ?? undefined) : undefined,
        scriptId: dataSource === 'script' && scriptId ? scriptId : undefined,
        config: runConfig,
      });
      navigate(`/app/runs/${run.runId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start run. Ensure API server (npm run server) and Maven/Java are installed.');
    } finally {
      setStarting(false);
    }
  };

  return (
    <>
      <PageHeader title="Run Test" subtitle="Select a saved script or legacy data source, then launch the Java Playwright engine" />

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 p-4 text-sm text-red-800">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      <div className="mx-auto max-w-3xl space-y-6">
        <section className="card">
          <h3 className="mb-4 font-display text-lg font-semibold">1. Select Test Mode</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <button onClick={() => { setMode('static'); setScriptId(''); }} className={`rounded-xl border-2 p-4 text-left transition ${mode === 'static' ? 'border-brand-500 bg-brand-50' : 'border-slate-200'}`}>
              <Zap className="mb-2 h-6 w-6 text-brand-600" />
              <div className="font-semibold">Static / User Experience</div>
              <p className="mt-1 text-xs text-slate-500">URL list + Lighthouse + Navigation Timing</p>
            </button>
            <button onClick={() => { setMode('scripted'); setScriptId(''); }} className={`rounded-xl border-2 p-4 text-left transition ${mode === 'scripted' ? 'border-brand-500 bg-brand-50' : 'border-slate-200'}`}>
              <FileText className="mb-2 h-6 w-6 text-brand-600" />
              <div className="font-semibold">Scripted Flow</div>
              <p className="mt-1 text-xs text-slate-500">Step-by-step UI scripts</p>
            </button>
          </div>
        </section>

        <section className="card">
          <h3 className="mb-4 font-display text-lg font-semibold">2. Select Script / Data Source</h3>
          <div className="mb-4 flex gap-2">
            <button onClick={() => setDataSource('script')} className={`rounded-lg px-4 py-2 text-sm font-semibold ${dataSource === 'script' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
              Saved Script
            </button>
            <button onClick={() => setDataSource('legacy')} className={`rounded-lg px-4 py-2 text-sm font-semibold ${dataSource === 'legacy' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
              Legacy / Crawled
            </button>
          </div>

          {dataSource === 'script' ? (
            <div>
              {filteredScripts.length === 0 ? (
                <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
                  No {mode} scripts saved yet. Create one in{' '}
                  <Link to="/app/script-studio" className="font-semibold text-brand-600 underline">Script Studio</Link>.
                </div>
              ) : (
                <div>
                  <label className="label">Choose Script</label>
                  <select className="input-field" value={scriptId} onChange={(e) => setScriptId(e.target.value)}>
                    <option value="">— Select a script —</option>
                    {filteredScripts.map((s) => (
                      <option key={s.id} value={s.id}>{s.name} ({s.stepCount} {s.type === 'static' ? 'URLs' : 'steps'})</option>
                    ))}
                  </select>
                  {urlCountPreview != null && scriptId && (
                    <p className="mt-1 text-xs text-slate-500">{urlCountPreview} URL{urlCountPreview === 1 ? '' : 's'} will be tested</p>
                  )}
                </div>
              )}
              <p className="mt-2 text-xs text-slate-400">
                <Clapperboard className="inline h-3 w-3" /> Scripts are stored in <code>data/scripts/</code> and used as test case CSV files.
              </p>
            </div>
          ) : mode === 'static' ? (
            <div className="space-y-3">
              {!lastCrawlId && testSuite === 'crawled' && (
                <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
                  No crawled URL set. Run the <strong>Website Crawler</strong> first, or enable Auto Crawl below.
                </div>
              )}
              <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 ${testSuite === 'crawled' ? 'border-brand-500 bg-brand-50' : 'border-slate-200'}`}>
                <input type="radio" name="suite" checked={testSuite === 'crawled'} onChange={() => setTestSuite('crawled')} className="mt-1" />
                <div>
                  <div className="font-medium">Crawled URLs {lastCrawlId && <span className="font-mono text-brand-600">(Run {lastCrawlId})</span>}</div>
                  {urlCountPreview != null && lastCrawlId && (
                    <p className="mt-1 text-xs text-slate-500">{urlCountPreview} URL{urlCountPreview === 1 ? '' : 's'} will be tested</p>
                  )}
                </div>
              </label>
              <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 ${testSuite === 'static' ? 'border-brand-500 bg-brand-50' : 'border-slate-200'}`}>
                <input type="radio" name="suite" checked={testSuite === 'static'} onChange={() => setTestSuite('static')} className="mt-1" />
                <div><div className="font-medium">Static Test Case File</div>
                  {urlCountPreview != null && testSuite === 'static' && (
                    <p className="mt-1 text-xs text-slate-500">{urlCountPreview} URL{urlCountPreview === 1 ? '' : 's'} will be tested</p>
                  )}
                </div>
              </label>
              <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 ${useAutoCrawl ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`}>
                <input type="checkbox" checked={useAutoCrawl} onChange={(e) => setUseAutoCrawl(e.target.checked)} className="mt-1" />
                <div>
                  <div className="flex items-center gap-2 font-medium"><Globe className="h-4 w-4" /> Auto Crawl before run (Java engine)</div>
                  <p className="text-xs text-slate-500">Uses CrawlerURL from Configuration</p>
                </div>
              </label>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Uses the default <code>ScriptedTestCasesFilePath.csv</code> from the project root.</p>
          )}
        </section>

        <section className="card">
          <h3 className="mb-4 font-display text-lg font-semibold">3. Execution Settings</h3>
          {execution && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="browserType">Browser Type</label>
                <select
                  id="browserType"
                  className="input-field"
                  value={execution.browserType}
                  onChange={(e) => setExecution({ ...execution, browserType: e.target.value as BrowserType })}
                >
                  <option value="chrome">Chrome (Chromium)</option>
                  <option value="firefox">Firefox</option>
                  <option value="webkit">WebKit (Safari)</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="multiThreading">Multi-threading</label>
                <input
                  id="multiThreading"
                  type="number"
                  min={1}
                  className="input-field"
                  value={execution.multiThreading}
                  onChange={(e) => setExecution({ ...execution, multiThreading: Number(e.target.value) || 1 })}
                />
                <p className="mt-1 text-xs text-slate-400">Parallel browser sessions (static: untested URLs; scripted: same flow per thread)</p>
              </div>
              <div>
                <label className="label" htmlFor="testDuration">Test Duration (seconds)</label>
                <input
                  id="testDuration"
                  type="number"
                  min={0}
                  className="input-field"
                  value={execution.testDurationSeconds}
                  onChange={(e) => setExecution({ ...execution, testDurationSeconds: Number(e.target.value) || 0 })}
                />
                <p className="mt-1 text-xs text-slate-400">0 = run once through all requests; &gt;0 = loop until time expires</p>
              </div>
              <div>
                <label className="label" htmlFor="thinkTime">Think-Time (ms)</label>
                <input
                  id="thinkTime"
                  type="number"
                  min={0}
                  className="input-field"
                  value={execution.thinkTime}
                  onChange={(e) => setExecution({ ...execution, thinkTime: Number(e.target.value) || 0 })}
                />
                <p className="mt-1 text-xs text-slate-400">Wait between each request / step</p>
              </div>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 p-4 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={execution.headlessMode}
                  onChange={(e) => setExecution({ ...execution, headlessMode: e.target.checked })}
                  className="h-4 w-4"
                />
                <div>
                  <div className="font-medium">Headless Mode</div>
                  <p className="text-xs text-slate-500">Run browsers without a visible window</p>
                </div>
              </label>
            </div>
          )}
        </section>

        <button
          onClick={handleStart}
          disabled={starting || !config || !execution || (dataSource === 'script' && !scriptId)}
          className="btn-primary w-full justify-center py-3 text-base"
        >
          <Play className="h-5 w-5" /> {starting ? 'Starting Java engine…' : 'Start Test Run'}
        </button>
      </div>
    </>
  );
}
