/**
 * API client — calls the Node backend that runs real crawl + Java test execution.
 */
import type {
  AppConfig, CrawledUrl, ScriptedStep, StaticResultRow,
  StaticTestCase, ScriptedResultRow, TestRun, RunMode, TestScript, RunReportAnalysis,
} from '../types';

const BASE = '/api';

let authToken: string | null = typeof localStorage !== 'undefined'
  ? localStorage.getItem('uipb_auth_token')
  : null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options?.headers as Record<string, string> | undefined),
    };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;

    const res = await fetch(`${BASE}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    });
    if (!res.ok) {
      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const err = await res.json();
        throw new Error(err.error || `Request failed: ${res.status}`);
      }
      const text = await res.text();
      throw new Error(
        text.includes('Cannot GET') || text.includes('<!DOCTYPE')
          ? `API route not found (${path}). Restart the API server: npm run server`
          : text.slice(0, 200) || `Request failed: ${res.status}`,
      );
    }
    if (res.headers.get('content-type')?.includes('application/json')) {
      return res.json();
    }
    return res as unknown as T;
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error('Request timed out. Report generation may take up to 2 minutes for large runs.');
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkBackendHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export const api = {
  async signup(payload: { name: string; email: string; password: string; company?: string }) {
    return request<{ token: string; user: { id: string; name: string; email: string; company?: string } }>(
      '/auth/signup',
      { method: 'POST', body: JSON.stringify(payload) },
    );
  },

  async login(payload: { email: string; password: string }) {
    return request<{ token: string; user: { id: string; name: string; email: string; company?: string } }>(
      '/auth/login',
      { method: 'POST', body: JSON.stringify(payload) },
    );
  },

  async logout() {
    return request<{ ok: boolean }>('/auth/logout', { method: 'POST' });
  },

  async getMe() {
    return request<{ id: string; name: string; email: string; company?: string }>('/auth/me');
  },

  async getConfig(): Promise<AppConfig> {
    return request<AppConfig>('/config');
  },

  async saveConfig(config: AppConfig): Promise<AppConfig> {
    return request<AppConfig>('/config', { method: 'PUT', body: JSON.stringify(config) });
  },

  async validateConfig(config: AppConfig): Promise<{ valid: boolean; errors: string[] }> {
    return request('/config/validate', { method: 'POST', body: JSON.stringify(config) });
  },

  async getStaticTestCases(): Promise<StaticTestCase[]> {
    return request<StaticTestCase[]>('/test-cases/static');
  },

  async saveStaticTestCases(cases: StaticTestCase[]): Promise<void> {
    await request('/test-cases/static', { method: 'PUT', body: JSON.stringify(cases) });
  },

  async createStaticTestCase(_tc: Omit<StaticTestCase, 'id'>): Promise<StaticTestCase> {
    const cases = await api.getStaticTestCases();
    const item = { ..._tc, id: String(Date.now()) };
    await api.saveStaticTestCases([...cases, item]);
    return item;
  },

  async updateStaticTestCase(_id: string, _tc: Partial<StaticTestCase>): Promise<StaticTestCase> {
    const cases = await api.getStaticTestCases();
    const idx = cases.findIndex((c) => c.id === _id);
    if (idx >= 0) cases[idx] = { ...cases[idx], ..._tc };
    await api.saveStaticTestCases(cases);
    return cases[idx];
  },

  async deleteStaticTestCase(id: string): Promise<void> {
    const cases = await api.getStaticTestCases();
    await api.saveStaticTestCases(cases.filter((c) => c.id !== id));
  },

  async importStaticTestCasesCsv(_file: File): Promise<StaticTestCase[]> {
    return api.getStaticTestCases();
  },

  async getScriptedSteps(): Promise<ScriptedStep[]> {
    return request<ScriptedStep[]>('/test-cases/scripted');
  },

  async saveScriptedSteps(steps: ScriptedStep[]): Promise<ScriptedStep[]> {
    await request('/test-cases/scripted', { method: 'PUT', body: JSON.stringify(steps) });
    return steps;
  },

  async getScriptedTestCaseNames(): Promise<string[]> {
    const steps = await api.getScriptedSteps();
    return [...new Set(steps.map((s) => s.testCaseName))];
  },

  async startCrawl(startUrl: string): Promise<{ crawlRunId: string; status: string }> {
    return request('/crawl', { method: 'POST', body: JSON.stringify({ startUrl }) });
  },

  async getCrawlStatus(crawlRunId: string): Promise<{ status: string; urlsFound: number; pagesVisited?: number; error: string | null }> {
    return request(`/crawl/${crawlRunId}/status`);
  },

  async cancelCrawl(crawlRunId: string): Promise<void> {
    await request(`/crawl/${crawlRunId}/cancel`, { method: 'POST' });
  },

  async getCrawledUrls(crawlRunId?: string): Promise<CrawledUrl[]> {
    if (!crawlRunId) return [];
    return request<CrawledUrl[]>(`/crawl/${crawlRunId}/urls`);
  },

  async saveCrawledAsTestSuite(crawlRunId: string, name: string): Promise<void> {
    sessionStorage.setItem('lastCrawlRunId', crawlRunId);
    sessionStorage.setItem('lastCrawlSuiteName', name);
  },

  async exportCrawledCsv(crawlRunId: string): Promise<Blob> {
    const res = await fetch(`${BASE}/crawl/${crawlRunId}/export.csv`);
    if (!res.ok) throw new Error('Export failed');
    return res.blob();
  },

  async getRuns(): Promise<TestRun[]> {
    return request<TestRun[]>('/runs');
  },

  async getRun(runId: string): Promise<TestRun | undefined> {
    try {
      return await request<TestRun>(`/runs/${runId}`);
    } catch {
      return undefined;
    }
  },

  async startRun(options: {
    mode: RunMode;
    useAutoCrawl?: boolean;
    testSuite?: 'static' | 'crawled' | 'scripted';
    crawlRunId?: string;
    scriptId?: string;
    config?: AppConfig;
  }): Promise<TestRun> {
    return request<TestRun>('/runs', { method: 'POST', body: JSON.stringify(options) });
  },

  async stopRun(runId: string): Promise<void> {
    await request(`/runs/${runId}/stop`, { method: 'POST' });
  },

  async deleteRun(runId: string): Promise<void> {
    await request(`/runs/${runId}`, { method: 'DELETE' });
  },

  async getStaticResults(runId: string): Promise<StaticResultRow[]> {
    return request<StaticResultRow[]>(`/runs/${runId}/results/static`);
  },

  async getScriptedResults(_runId: string): Promise<ScriptedResultRow[]> {
    return [];
  },

  async exportRunCsv(runId: string, _mode: RunMode): Promise<Blob> {
    const res = await fetch(`${BASE}/runs/${runId}/export.csv`);
    if (!res.ok) throw new Error('Report not ready yet — wait for the run to finish.');
    return res.blob();
  },

  async getLighthouseJson(_runId: string, pageUrl: string): Promise<object | null> {
    return { url: pageUrl };
  },

  async getRunReport(runId: string): Promise<{
    runId: string;
    results: StaticResultRow[];
    analysis: RunReportAnalysis;
    pages?: import('../types').RunReportPage[];
    llmAnalysis?: import('../types').GoLiveAnalysis | null;
    meta?: import('../types').RunReportMeta;
  }> {
    return request(`/runs/${runId}/report`);
  },

  getRunReportHtmlUrl(runId: string): string {
    return `${BASE}/runs/${runId}/report.html`;
  },

  async syncLegacyScripts(): Promise<{ synced: number; scripts: TestScript[] }> {
    return request('/scripts/sync-legacy', { method: 'POST' });
  },

  async saveCrawledAsScript(crawlRunId: string, name: string): Promise<TestScript> {
    return request(`/crawl/${crawlRunId}/save-script`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  },

  async listScripts(type?: 'static' | 'scripted'): Promise<TestScript[]> {
    const q = type ? `?type=${type}` : '';
    return request<TestScript[]>(`/scripts${q}`);
  },

  async getScript(id: string): Promise<TestScript & { rows?: unknown[]; headers?: string[] }> {
    return request(`/scripts/${id}`);
  },

  async saveScript(payload: {
    id?: string;
    name: string;
    type: 'static' | 'scripted';
    description?: string;
    rows: unknown[];
  }): Promise<TestScript> {
    return request<TestScript>('/scripts', { method: 'POST', body: JSON.stringify(payload) });
  },

  async deleteScript(id: string): Promise<void> {
    await request(`/scripts/${id}`, { method: 'DELETE' });
  },

  async renameScript(id: string, name: string): Promise<TestScript> {
    try {
      return await request<TestScript>(`/scripts/${id}/rename`, { method: 'POST', body: JSON.stringify({ name }) });
    } catch {
      return request<TestScript>(`/scripts/${id}`, { method: 'PUT', body: JSON.stringify({ name }) });
    }
  },

  async startRecorder(url: string): Promise<{ sessionId: string; message: string }> {
    return request('/recorder/start', { method: 'POST', body: JSON.stringify({ url }) });
  },

  async getRecorderStatus(sessionId: string): Promise<{ sessionId: string; stepCount: number; active: boolean }> {
    return request(`/recorder/${sessionId}/status`);
  },

  async stopRecorder(sessionId: string, testCaseName?: string): Promise<{ testCaseName: string; steps: Array<Partial<ScriptedStep> & { objectName?: string }> } | null> {
    return request(`/recorder/${sessionId}/stop`, { method: 'POST', body: JSON.stringify({ testCaseName }) });
  },

  async cancelRecorder(sessionId: string): Promise<void> {
    await request(`/recorder/${sessionId}/cancel`, { method: 'POST' });
  },
};
