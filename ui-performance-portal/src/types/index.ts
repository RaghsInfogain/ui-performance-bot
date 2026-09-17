export type BrowserType = 'chrome' | 'firefox' | 'webkit';
export type RunMode = 'static' | 'scripted';
export type RunStatus = 'queued' | 'crawling' | 'running' | 'completed' | 'failed' | 'stopped';

export interface AppConfig {
  headlessMode: boolean;
  browserType: BrowserType;
  testDurationSeconds: number | null;
  takeScreenshot: boolean;
  scriptedFlow: boolean;
  userExperience: boolean;
  autoCrawl: boolean;
  thinkTime: number;
  multiThreading: number;
  crawlerUrl: string;
  resultDirectory: string;
  screenshotDirectory: string;
}

export interface StaticTestCase {
  id: string;
  transactionName: string;
  pageUrl: string;
  elementIdentifier: string;
  elementSelector: string;
}

export interface ScriptedStep {
  id: string;
  testCaseName: string;
  transactionName: string;
  testStep: string;
  request: string;
  selector: string;
  locator: string;
  action: string;
  parameter: string;
  elementToWait: string;
  elementIdentifier: string;
  frameSelector: string;
  timeout?: number;
}

export interface CrawledUrl {
  id: string;
  transactionName: string;
  pageUrl: string;
  elementIdentifier: string;
  elementSelector: string;
  crawlRunId: string;
}

export interface TestRun {
  id: string;
  runId: string;
  mode: RunMode;
  status: RunStatus;
  startedAt: string;
  endedAt?: string;
  hostname: string;
  configSnapshot: Partial<AppConfig>;
  urlsTotal: number;
  urlsCompleted: number;
  passCount: number;
  failCount: number;
  avgPerformanceScore?: number;
  testDurationSeconds?: number | null;
  multiThreading?: number;
  scriptId?: string | null;
  crawlRunId?: string;
}

export interface StaticResultRow {
  runId: string;
  timestamp: string;
  hostname: string;
  transaction: string;
  pageUrl: string;
  fcp: number;
  lcp: number;
  tbt: number;
  cls: number;
  speedIndex: number;
  performanceScore: number;
  accessibilityScore?: number;
  bestPracticesScore?: number;
  seoScore?: number;
  pageLoadTime: number;
  networkTime: number;
  dnsLookupTime: number;
  connectionTime: number;
  serverProcessingTime: number;
  responseTime: number;
  browserTime: number;
  domInteractionTime: number;
  domCompleteTime: number;
  playwrightPageLoadTime: number;
  elementLoadTime: string;
  testStatus: 'PASS' | 'FAIL';
  failureReason: string;
}

export interface ScriptedResultRow {
  runId: string;
  timestamp: string;
  transaction: string;
  hostname: string;
  testStepName: string;
  request: string;
  waitingElement: string;
  waitingElementLoadTime: string;
  playwrightPageLoadTime: string;
  testStatus: 'PASS' | 'FAIL';
  failureReason: string;
  pageLoadTime: string;
  fcp: string;
  lcp: string;
  performanceScore: string;
}

export const SCRIPTED_ACTIONS = [
  'Navigate', 'Click', 'Set_Text', 'WaitForSelector', 'SelectOption',
  'Check', 'Uncheck', 'Hover', 'PressKey', 'ThinkTime',
  'CalculateFullPageLoadTime', 'SwitchFrame', 'SwitchWindow', 'Get_Text',
  'ClickSwitchToNewTabAndGetText', 'SwitchToNewTabAndGetText', 'WaitUntilElementIsVisible',
] as const;

export interface TestScript {
  id: string;
  name: string;
  type: 'static' | 'scripted';
  source?: 'studio' | 'legacy' | 'crawled';
  crawlRunId?: string | null;
  description: string;
  filePath: string;
  stepCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RunReportMeta {
  analyzer?: string;
  lighthouseJsonCount?: number;
  navigationRowCount?: number;
  csvRowCount?: number;
  pythonError?: string;
  runDirectory?: string;
  csvExists?: boolean;
  htmlReportPath?: string;
}

export interface RunReportPage {
  transaction: string;
  pageUrl: string;
  lighthouseFile?: string;
  fcp?: number;
  lcp?: number;
  tbt?: number;
  cls?: number;
  performanceScore?: number;
  accessibilityScore?: number;
  bestPracticesScore?: number;
  seoScore?: number;
  pageLoadTime?: number;
  networkTime?: number;
  dnsLookupTime?: number;
  connectionTime?: number;
  serverProcessingTime?: number;
  responseTime?: number;
  browserTime?: number;
  domInteractionTime?: number;
  domCompleteTime?: number;
  playwrightPageLoadTime?: number;
  practicalMetrics?: Record<string, { value: number; formula: string; purpose: string }> | null;
  practicalWaterfall?: Array<{
    label: string;
    start: number;
    duration: number;
    formula?: string;
    purpose?: string;
    estimated?: boolean;
  }>;
  navTimingFile?: string;
  testStatus?: 'PASS' | 'FAIL';
  opportunities?: Array<{ id: string; title: string; score: number | null; savingsMs: number; displayValue?: string }>;
  hasLighthouseJson?: boolean;
  hasNavigationData?: boolean;
}

export interface RunReportAnalysis {
  summary: {
    total: number;
    passRate: number;
    avgScore: number;
    avgLcp: number;
    avgFcp: number;
    avgPageLoad: number;
    avgNetwork: number;
    avgDns: number;
    avgTbt: number;
    avgCls: number;
    lighthouseJsonCount?: number;
    navigationRowCount?: number;
  };
  findings: Array<{
    transaction: string;
    pageUrl: string;
    severity: 'high' | 'medium' | 'low';
    issues: string[];
    testStatus: string;
  }>;
  charts: {
    scores: Array<{ name: string; score: number; lcp: number; pageLoad: number }>;
    navigation: Array<{ name: string; dns: number; connection: number; server: number; response: number; browser: number; dom: number }>;
    lighthouse: Array<{ name: string; fcp: number; lcp: number; tbt: number; cls: number; speedIndex: number }>;
  };
}

export interface GoLiveAnalysis {
  verdict: 'GO_LIVE' | 'NOT_GO_LIVE' | 'CONDITIONAL';
  verdictLabel: string;
  confidence: number;
  executiveSummary: string;
  justification: {
    summary: string;
    blockers: string[];
    risks: string[];
    positives: string[];
    llmTopReasons?: string[];
  };
  criteria: Array<{
    name: string;
    status: 'pass' | 'warn' | 'fail';
    detail: string;
    weight: number;
  }>;
  recommendations: string[];
  reportDetails: {
    runId: string;
    pagesAnalyzed: number;
    lighthouseFiles: number;
    navigationRows: number;
    passRate: number;
    avgScore: number;
    avgLcp: number;
    avgPageLoad: number;
    criticalIssues: Array<{
      transaction: string;
      pageUrl: string;
      severity: string;
      issues: string[];
    }>;
    perPageSummary: Array<{
      transaction: string;
      pageUrl: string;
      score: number;
      lcp: number;
      pageLoadTime: number;
      testStatus: string;
      cwvStatus: string;
      cwvIssues: string[];
      hasLighthouse: boolean;
    }>;
  };
  generatedBy: string;
  llmEnhanced?: boolean;
}
