/**
 * API client — calls the Node backend that runs real crawl + Java test execution.
 */
import type {
  AppConfig, CrawledUrl, ScriptedStep, StaticResultRow,
  StaticTestCase, ScriptedResultRow, TestRun, RunMode, TestScript, RunReportAnalysis,
  ExecutionSettings, BatchRunResult, ScriptTestData, TestDataMode,
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

  async startBatchRun(options: {
    scripts: { scriptId: string; loadPercent: number }[];
    execution: ExecutionSettings;
  }): Promise<BatchRunResult> {
    return request<BatchRunResult>('/runs/batch', { method: 'POST', body: JSON.stringify(options) });
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

  async getScriptedResults(runId: string): Promise<ScriptedResultRow[]> {
    return request<ScriptedResultRow[]>(`/runs/${runId}/results/scripted`);
  },

  async exportRunCsv(runId: string, _mode: RunMode): Promise<Blob> {
    const res = await fetch(`${BASE}/runs/${runId}/export.csv`);
    if (!res.ok) throw new Error('Report not ready yet — wait for the run to finish.');
    return res.blob();
  },

  async getLighthouseJson(_runId: string, pageUrl: string): Promise<object | null> {
    return { url: pageUrl };
  },

  async getRunReport(runId: string, opts?: { regenerate?: boolean }): Promise<{
    runId: string;
    results: StaticResultRow[];
    analysis: RunReportAnalysis;
    pages?: import('../types').RunReportPage[];
    llmAnalysis?: import('../types').GoLiveAnalysis | null;
    meta?: import('../types').RunReportMeta & { cached?: boolean; generatedAt?: string; generator?: string };
  }> {
    const q = opts?.regenerate ? '?regenerate=1' : '';
    return request(`/runs/${runId}/report${q}`);
  },

  async regenerateRunReport(runId: string): Promise<{
    runId?: string;
    results: StaticResultRow[];
    analysis: RunReportAnalysis;
    pages?: import('../types').RunReportPage[];
    llmAnalysis?: import('../types').GoLiveAnalysis | null;
    meta?: import('../types').RunReportMeta & { cached?: boolean; generatedAt?: string; generator?: string };
  }> {
    return request(`/runs/${runId}/report/regenerate`, { method: 'POST' });
  },

  getRunReportHtmlUrl(runId: string): string {
    return `${BASE}/runs/${runId}/report.html`;
  },

  async compareRuns(baseline: string, current: string) {
    return request<import('../types').RunComparison>(
      `/compare-runs?baseline=${encodeURIComponent(baseline)}&current=${encodeURIComponent(current)}`,
    );
  },

  async listSchedules() {
    return request<import('../types').RunSchedule[]>('/schedules');
  },

  async saveSchedule(payload: Partial<import('../types').RunSchedule> & { name: string; frequency: string }) {
    if (payload.id) {
      return request<import('../types').RunSchedule>(`/schedules/${payload.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    }
    return request<import('../types').RunSchedule>('/schedules', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async deleteSchedule(id: string) {
    await request(`/schedules/${id}`, { method: 'DELETE' });
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
    source?: 'studio' | 'legacy' | 'crawled';
    crawlRunId?: string | null;
  }): Promise<TestScript> {
    return request<TestScript>('/scripts', { method: 'POST', body: JSON.stringify(payload) });
  },

  async getScriptData(id: string): Promise<ScriptTestData | null> {
    return request<ScriptTestData | null>(`/scripts/${encodeURIComponent(id)}/data`);
  },

  /** Upload (or replace) the script's test data CSV; sent as raw text. */
  async uploadScriptData(id: string, csv: string, fileName: string, mode?: TestDataMode): Promise<ScriptTestData> {
    const q = new URLSearchParams({ fileName, ...(mode ? { mode } : {}) });
    return request<ScriptTestData>(`/scripts/${encodeURIComponent(id)}/data?${q}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/csv' },
      body: csv,
    });
  },

  async setScriptDataMode(id: string, mode: TestDataMode): Promise<ScriptTestData> {
    return request<ScriptTestData>(`/scripts/${encodeURIComponent(id)}/data?mode=${mode}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/csv' },
      body: '',
    });
  },

  async deleteScriptData(id: string): Promise<void> {
    await request(`/scripts/${encodeURIComponent(id)}/data`, { method: 'DELETE' });
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

  async getRecorderStatus(sessionId: string): Promise<{
    sessionId: string;
    stepCount: number;
    active: boolean;
    startUrl?: string;
    startedAt?: number;
    steps?: Array<{
      index: number;
      action: string;
      testStep?: string;
      selector?: string;
      locatorStrategy?: string;
      locatorLabel?: string;
      locatorCandidates?: Array<{ strategy: string; selector: string; label?: string; unique?: boolean; score?: number }>;
      parameter?: string;
      pageUrl?: string;
      objectName?: string;
    }>;
  }> {
    return request(`/recorder/${sessionId}/status`);
  },

  async stopRecorder(sessionId: string, testCaseName?: string): Promise<{
    testCaseName: string;
    steps: Array<Partial<ScriptedStep> & { objectName?: string }>;
    scripted?: Array<Record<string, unknown>>;
    static?: Array<{ transactionName: string; pageUrl: string; elementIdentifier: string; elementSelector: string }>;
    stepCount?: number;
    urlCount?: number;
    recordingId?: string | null;
    recording?: RecordingMeta | null;
  } | null> {
    return request(`/recorder/${sessionId}/stop`, { method: 'POST', body: JSON.stringify({ testCaseName }) });
  },

  async cancelRecorder(sessionId: string): Promise<void> {
    await request(`/recorder/${sessionId}/cancel`, { method: 'POST' });
  },

  async listRecordings(): Promise<RecordingMeta[]> {
    return request('/recordings');
  },

  async getRecording(id: string): Promise<RecordingDetail> {
    return request(`/recordings/${id}`);
  },

  async saveRecording(payload: {
    name: string;
    startUrl?: string;
    steps: unknown[];
  }): Promise<RecordingDetail> {
    return request('/recordings', { method: 'POST', body: JSON.stringify(payload) });
  },

  async updateRecording(id: string, payload: {
    name?: string;
    startUrl?: string;
    steps?: unknown[];
  }): Promise<RecordingDetail> {
    return request(`/recordings/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  },

  async deleteRecording(id: string): Promise<void> {
    await request(`/recordings/${id}`, { method: 'DELETE' });
  },

  async generateScriptFromRecording(id: string, payload: {
    type: 'static' | 'scripted';
    name?: string;
  }): Promise<TestScript> {
    return request(`/recordings/${id}/generate-script`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async replayRecording(id: string, payload?: {
    steps?: unknown[];
    startUrl?: string;
    headless?: boolean;
    stepTimeout?: number;
    name?: string;
  }): Promise<ReplayResult> {
    return request(`/recordings/${id}/replay`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    });
  },

  async replaySteps(payload: {
    startUrl?: string;
    steps: unknown[];
    headless?: boolean;
    stepTimeout?: number;
    name?: string;
  }): Promise<ReplayResult> {
    return request('/recorder/replay', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async getReplayStatus(replayId: string): Promise<ReplayResult> {
    return request(`/recorder/replay/${replayId}`);
  },

  replayReportUrl(replayId: string): string {
    return `${BASE}/recorder/replay/${replayId}/report.csv`;
  },
};

export type ReplayStepResult = {
  index: number;
  action: string;
  testStep?: string;
  transactionName?: string;
  selector?: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  error?: string;
  durationMs?: number;
  timestamp?: string;
  /** Same-site server calls (page loads, XHR, fetch) made while this step ran. */
  requests?: CapturedRequest[];
};

export type CapturedRequest = { method: string; url: string; type: string };

export type ReplayResult = {
  replayId?: string;
  status?: 'running' | 'completed' | 'failed';
  ok: boolean;
  passed: number;
  failed: number;
  skipped?: number;
  total: number;
  currentStep?: number;
  results: ReplayStepResult[];
  reportPath?: string;
  reportCsv?: string;
  reportJson?: string;
  error?: string;
};

export type RecordingMeta = {
  id: string;
  name: string;
  startUrl: string;
  stepCount: number;
  urlCount: number;
  createdAt: string;
  updatedAt: string;
};

export type RecordingDetail = RecordingMeta & {
  steps: Array<Record<string, unknown>>;
  scripted?: Array<Record<string, unknown>>;
  static?: Array<{ transactionName: string; pageUrl: string; elementIdentifier: string; elementSelector: string }>;
};
