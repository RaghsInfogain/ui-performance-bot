import { useEffect, useState, useRef } from 'react';
import { Globe, Download, Save, Play, AlertCircle, Square, ArrowLeft, CheckCircle2, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/layout/AppLayout';
import { DataTable } from '../components/common/DataTable';
import { ExecutionSettingsForm, defaultExecution } from '../components/run/ExecutionSettingsForm';
import { api } from '../services/api';
import type { CrawledUrl, ExecutionSettings, TestScript } from '../types';

function defaultScriptName(startUrl: string) {
  let host = 'Crawl';
  try { host = new URL(startUrl).hostname.replace(/^www\./, ''); } catch { /* keep default */ }
  return `${host} crawl ${new Date().toLocaleDateString()}`;
}

export default function Crawler() {
  const navigate = useNavigate();
  const [startUrl, setStartUrl] = useState('https://www.virginaustralia.com/au/en/');
  const [crawling, setCrawling] = useState(false);
  const [crawlRunId, setCrawlRunId] = useState<string | null>(null);
  const [urls, setUrls] = useState<CrawledUrl[]>([]);
  const [suiteName, setSuiteName] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError] = useState('');
  const [crawlFinished, setCrawlFinished] = useState(false);
  const [savePromptDismissed, setSavePromptDismissed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedScript, setSavedScript] = useState<TestScript | null>(null);
  const [execution, setExecution] = useState<ExecutionSettings | null>(null);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    api.getConfig().then((c) => {
      if (c.crawlerUrl) setStartUrl(c.crawlerUrl);
      setExecution(defaultExecution(c));
    });
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    if (crawlRunId && !crawling) api.getCrawledUrls(crawlRunId).then(setUrls);
  }, [crawlRunId, crawling]);

  const pollCrawl = (id: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const status = await api.getCrawlStatus(id);
        setStatusMsg(`Status: ${status.status} — ${status.urlsFound} URLs found${status.pagesVisited ? `, ${status.pagesVisited} pages visited` : ''}`);

        if (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') {
          setCrawling(false);
          if (pollRef.current) clearInterval(pollRef.current);
          const data = await api.getCrawledUrls(id);
          setUrls(data);
          setCrawlFinished(status.status !== 'failed');
          if (status.status !== 'failed' && data.length) setSuiteName((n) => n || defaultScriptName(startUrl));
          if (status.status === 'failed') setError(status.error || 'Crawl failed');
          else if (status.status === 'cancelled') setError('');
          else {
            setError('');
            sessionStorage.setItem('lastCrawlRunId', id);
          }
        } else {
          const data = await api.getCrawledUrls(id);
          setUrls(data);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Poll failed');
        setCrawling(false);
        if (pollRef.current) clearInterval(pollRef.current);
      }
    }, 2000);
  };

  const handleCrawl = async () => {
    setError('');
    setCrawling(true);
    setUrls([]);
    setCrawlFinished(false);
    setSavePromptDismissed(false);
    setSavedScript(null);
    setSuiteName('');
    setStatusMsg('Starting crawl…');
    try {
      const result = await api.startCrawl(startUrl);
      setCrawlRunId(result.crawlRunId);
      sessionStorage.setItem('lastCrawlRunId', result.crawlRunId);
      pollCrawl(result.crawlRunId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start crawl. Is the API server running? Run: npm run server');
      setCrawling(false);
    }
  };

  const handleStopCrawl = async () => {
    if (!crawlRunId) return;
    try {
      await api.cancelCrawl(crawlRunId);
      setStatusMsg('Stopping crawl…');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to stop crawl');
    }
  };

  const handleExport = async () => {
    if (!crawlRunId) return;
    try {
      const blob = await api.exportCrawledCsv(crawlRunId);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `crawled_urls_${crawlRunId}.csv`;
      a.click();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    }
  };

  const handleSaveSuite = async () => {
    if (!crawlRunId || !suiteName.trim()) return;
    setSaving(true);
    setError('');
    try {
      const script = await api.saveCrawledAsScript(crawlRunId, suiteName.trim());
      sessionStorage.setItem('lastCrawlRunId', crawlRunId);
      sessionStorage.setItem('lastCrawlSuiteName', suiteName.trim());
      setSavedScript(script);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save script');
    } finally {
      setSaving(false);
    }
  };

  const handleRunScript = async () => {
    if (!savedScript || !execution) return;
    setStarting(true);
    setError('');
    try {
      const result = await api.startBatchRun({
        scripts: [{ scriptId: savedScript.id, loadPercent: 100 }],
        execution,
      });
      navigate(`/app/runs/${result.runs[0].runId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start run. Ensure API server (npm run server) and Maven/Java are installed.');
    } finally {
      setStarting(false);
    }
  };

  const canSave = crawlFinished && !crawling && urls.length > 0 && !savedScript;

  return (
    <>
      <PageHeader
        title="Website Crawler"
        subtitle="Discover same-domain URLs and save them as a crawled script"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/app/scripts" className="btn-secondary text-sm">
              <ArrowLeft className="h-4 w-4" /> Back to Scripts
            </Link>
            <Link to="/app/run-test" className="btn-secondary text-sm">
              <Play className="h-4 w-4" /> Run Test
            </Link>
            {crawlRunId && urls.length > 0 && !crawling && (
              <button type="button" onClick={handleExport} className="btn-secondary"><Download className="h-4 w-4" /> Export CSV</button>
            )}
          </div>
        }
      />

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 p-4 text-sm text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      <div className="mb-6 card">
        <h3 className="mb-4 font-display font-semibold">Start Crawl</h3>
        <div className="flex flex-wrap gap-3">
          <input
            type="url"
            className="input-field min-w-0 flex-1"
            value={startUrl}
            onChange={(e) => setStartUrl(e.target.value)}
            placeholder="https://www.example.com/"
            disabled={crawling}
          />
          <button onClick={handleCrawl} disabled={crawling} className="btn-primary">
            <Globe className="h-4 w-4" /> {crawling ? 'Crawling…' : 'Start Crawl'}
          </button>
          {crawling && (
            <button onClick={handleStopCrawl} className="btn-danger">
              <Square className="h-4 w-4" /> Stop
            </button>
          )}
        </div>
        {statusMsg && <p className="mt-2 text-sm text-brand-600">{statusMsg}</p>}
        <p className="mt-2 text-xs text-slate-400">
          Crawls same-domain links (max 50 pages, 2 min timeout). Requires API server: <code className="rounded bg-slate-100 px-1">npm run server</code>
        </p>
        {crawlRunId && <p className="mt-2 text-sm text-slate-600">Crawl Run ID: <span className="font-mono font-semibold">{crawlRunId}</span></p>}
      </div>

      {canSave && !savePromptDismissed && (
        <div className="mb-6 card border-2 border-brand-200">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 font-display font-semibold">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" /> Crawl complete — save this session as a script?
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                {urls.length} URL{urls.length === 1 ? '' : 's'} discovered. Save them as a Crawled Session script to run now or later.
              </p>
            </div>
            <button type="button" onClick={() => setSavePromptDismissed(true)} className="text-slate-400 hover:text-slate-600" aria-label="Dismiss">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1">
              <label className="label" htmlFor="scriptName">Script name</label>
              <input
                id="scriptName"
                className="input-field"
                value={suiteName}
                onChange={(e) => setSuiteName(e.target.value)}
                placeholder="e.g. VA Production Pages"
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveSuite(); }}
              />
            </div>
            <button onClick={handleSaveSuite} disabled={!suiteName.trim() || saving} className="btn-primary">
              <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save as Script'}
            </button>
            <button type="button" onClick={() => setSavePromptDismissed(true)} className="btn-secondary">Not now</button>
          </div>
        </div>
      )}

      {canSave && savePromptDismissed && (
        <div className="mb-4 flex justify-end">
          <button type="button" onClick={() => setSavePromptDismissed(false)} className="btn-secondary text-sm">
            <Save className="h-4 w-4" /> Save session as script
          </button>
        </div>
      )}

      {savedScript && (
        <div className="mb-6 card border-2 border-emerald-200">
          <h3 className="mb-1 flex items-center gap-2 font-display font-semibold">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" /> Saved as script “{savedScript.name}”
          </h3>
          <p className="mb-4 text-sm text-slate-500">
            Configure execution and run it now, or{' '}
            <Link to={`/app/run-test?scriptId=${encodeURIComponent(savedScript.id)}`} className="font-semibold text-brand-600 underline">
              combine it with other scripts
            </Link>{' '}on the Run Test page.
          </p>
          {execution && <ExecutionSettingsForm value={execution} onChange={setExecution} idPrefix="crawl-exec" />}
          <button
            onClick={handleRunScript}
            disabled={starting || !execution}
            className="btn-primary mt-4 w-full justify-center py-3 text-base"
          >
            <Play className="h-5 w-5" /> {starting ? 'Starting Java engine…' : 'Run Script'}
          </button>
        </div>
      )}

      <div className="card overflow-hidden p-0">
        <div className="border-b border-slate-100 px-6 py-4">
          <h3 className="font-display font-semibold">Discovered URLs ({urls.length})</h3>
        </div>
        {urls.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-400">
            {crawling ? 'Crawling in progress… URLs will appear here.' : 'Start a crawl to discover URLs.'}
          </p>
        ) : (
          <DataTable scrollY maxHeight="480px" tableClassName="text-left text-sm">
            <colgroup>
              <col style={{ width: '20%' }} />
              <col style={{ width: '40%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '28%' }} />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-3">Transaction Name</th>
                <th className="px-4 py-3">Path Page URL</th>
                <th className="px-4 py-3">Element Identifier</th>
                <th className="px-4 py-3">Element Selector</th>
              </tr>
            </thead>
            <tbody>
              {urls.map((u) => (
                <tr key={u.id + u.pageUrl} className="border-t border-slate-50 hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-medium" title={u.transactionName}>
                    <span className="cell-truncate">{u.transactionName}</span>
                  </td>
                  <td className="px-4 py-3 text-brand-600" title={u.pageUrl}>
                    <span className="cell-truncate">{u.pageUrl}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{u.elementIdentifier || '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500" title={u.elementSelector || undefined}>
                    <span className="cell-truncate">{u.elementSelector || '—'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </div>
    </>
  );
}
