import { useEffect, useState, useRef } from 'react';
import { Globe, Download, Save, Play, AlertCircle, Square } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/layout/AppLayout';
import { DataTable } from '../components/common/DataTable';
import { api } from '../services/api';
import type { CrawledUrl } from '../types';

export default function Crawler() {
  const [startUrl, setStartUrl] = useState('https://www.virginaustralia.com/au/en/');
  const [crawling, setCrawling] = useState(false);
  const [crawlRunId, setCrawlRunId] = useState<string | null>(null);
  const [urls, setUrls] = useState<CrawledUrl[]>([]);
  const [suiteName, setSuiteName] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    api.getConfig().then((c) => {
      if (c.crawlerUrl) setStartUrl(c.crawlerUrl);
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
    if (!crawlRunId || !suiteName) return;
    try {
      await api.saveCrawledAsScript(crawlRunId, suiteName);
      sessionStorage.setItem('lastCrawlRunId', crawlRunId);
      sessionStorage.setItem('lastCrawlSuiteName', suiteName);
      alert(`Saved as script "${suiteName}" in Script Library (crawl_${crawlRunId})`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save script');
    }
  };

  return (
    <>
      <PageHeader
        title="Website Crawler"
        subtitle="Discover same-domain URLs — writes to Results/crawled_urls_&lt;runId&gt;.csv"
        actions={
          crawlRunId && urls.length > 0 && (
            <>
              <button onClick={handleExport} className="btn-secondary"><Download className="h-4 w-4" /> Export CSV</button>
              <Link to="/app/run-test" className="btn-primary"><Play className="h-4 w-4" /> Run Tests on URLs</Link>
            </>
          )
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

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <label className="label">Save as Test Suite</label>
          <input className="input-field" value={suiteName} onChange={(e) => setSuiteName(e.target.value)} placeholder="e.g. VA Production Pages" />
        </div>
        <button onClick={handleSaveSuite} disabled={!suiteName || !crawlRunId} className="btn-secondary"><Save className="h-4 w-4" /> Save Suite</button>
      </div>

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
              <col style={{ width: '22%' }} />
              <col style={{ width: '58%' }} />
              <col style={{ width: '20%' }} />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-3">Transaction</th>
                <th className="px-4 py-3">Path Page URL</th>
                <th className="px-4 py-3">Selector</th>
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
                  <td className="px-4 py-3 text-slate-400" title={u.elementSelector || undefined}>
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
