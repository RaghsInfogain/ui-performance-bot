import type {
  AppConfig, CrawledUrl, ScriptedStep, StaticResultRow,
  StaticTestCase, ScriptedResultRow, TestRun,
} from '../types';

export const defaultConfig: AppConfig = {
  headlessMode: true,
  browserType: 'chrome',
  testDurationSeconds: 500,
  takeScreenshot: false,
  scriptedFlow: false,
  userExperience: true,
  autoCrawl: true,
  thinkTime: 0,
  multiThreading: 10,
  crawlerUrl: 'https://www.virginaustralia.com/au/en/',
  resultDirectory: '../Results',
  screenshotDirectory: '../screenshots',
};

export const mockStaticTestCases: StaticTestCase[] = [
  { id: '1', transactionName: 'Home_Page', pageUrl: 'https://www.genesis.com/us/en/home', elementIdentifier: 'XPath', elementSelector: '//div[@class="genesis__heading-wrapper"]' },
  { id: '2', transactionName: 'Vehicle_Landing_Page', pageUrl: 'https://www.genesis.com/us/en/g70', elementIdentifier: 'XPath', elementSelector: '//div[@class="model-hero__msrp"]' },
  { id: '3', transactionName: 'Build_Page', pageUrl: 'https://www.genesis.com/us/en/build-and-price', elementIdentifier: 'XPath', elementSelector: '//button[@class="genesis-tabs__tab"]' },
];

export const mockScriptedSteps: ScriptedStep[] = [
  { id: '1', testCaseName: 'Orange_HRM', transactionName: 'TC01_LaunchToLogin', testStep: 'Launch login page', request: 'Get:/web/index.php/auth/login', selector: 'NA', locator: 'Xpath', action: 'Navigate', parameter: 'https://opensource-demo.orangehrmlive.com/web/index.php/auth/login', elementToWait: 'Xpath', elementIdentifier: "//h5[normalize-space()='Login']", frameSelector: '' },
  { id: '2', testCaseName: 'Orange_HRM', transactionName: '', testStep: 'Think Time on Login Page', request: '', selector: "//button[normalize-space()='Login']", locator: 'Xpath', action: 'ThinkTime', parameter: '300', elementToWait: 'Xpath', elementIdentifier: "//h5[normalize-space()='Login']", frameSelector: '' },
  { id: '3', testCaseName: 'Orange_HRM', transactionName: '', testStep: 'Enter Username', request: '', selector: "//input[@placeholder='Username']", locator: 'Xpath', action: 'Set_Text', parameter: 'Admin', elementToWait: 'Xpath', elementIdentifier: "//h5[normalize-space()='Login']", frameSelector: '' },
  { id: '4', testCaseName: 'Orange_HRM', transactionName: 'TC02_OHRM_Dashboard', testStep: 'Wait for Dashboard', request: 'Get:/web/index.php/dashboard/index', selector: "//h6[normalize-space()='Dashboard']", locator: 'Xpath', action: 'CalculateFullPageLoadTime', parameter: '', elementToWait: 'Xpath', elementIdentifier: "//h6[normalize-space()='Dashboard']", frameSelector: '' },
];

export const mockCrawledUrls: CrawledUrl[] = [
  { id: '1', transactionName: 'au/en/book/', pageUrl: 'https://www.virginaustralia.com/au/en/book/', elementIdentifier: '', elementSelector: '', crawlRunId: '0408' },
  { id: '2', transactionName: 'au-en/holidays', pageUrl: 'https://www.virginaustralia.com/au-en/holidays', elementIdentifier: '', elementSelector: '', crawlRunId: '0408' },
  { id: '3', transactionName: 'au/en/specials/', pageUrl: 'https://www.virginaustralia.com/au/en/specials/', elementIdentifier: '', elementSelector: '', crawlRunId: '0408' },
  { id: '4', transactionName: 'au/en/flights/', pageUrl: 'https://www.virginaustralia.com/au/en/flights/', elementIdentifier: '', elementSelector: '', crawlRunId: '0408' },
];

export const mockRuns: TestRun[] = [
  { id: 'r1', runId: '0408', mode: 'static', status: 'completed', startedAt: '2026-03-09T12:24:00', endedAt: '2026-03-09T12:32:00', hostname: 'MBP-V7W25N293D', configSnapshot: { userExperience: true, autoCrawl: true }, urlsTotal: 8, urlsCompleted: 8, passCount: 8, failCount: 0, avgPerformanceScore: 0.34, crawlRunId: '0408' },
  { id: 'r2', runId: '0407', mode: 'static', status: 'completed', startedAt: '2026-03-06T23:34:00', endedAt: '2026-03-06T23:41:00', hostname: 'MBP-V7W25N293D', configSnapshot: { userExperience: true }, urlsTotal: 8, urlsCompleted: 8, passCount: 8, failCount: 0, avgPerformanceScore: 0.31 },
  { id: 'r3', runId: '0403', mode: 'scripted', status: 'completed', startedAt: '2026-03-03T12:19:00', endedAt: '2026-03-03T12:25:00', hostname: 'MBP-V7W25N293D', configSnapshot: { scriptedFlow: true }, urlsTotal: 9, urlsCompleted: 9, passCount: 7, failCount: 2 },
  { id: 'r4', runId: '0409', mode: 'static', status: 'running', startedAt: '2026-03-09T14:00:00', hostname: 'MBP-V7W25N293D', configSnapshot: { userExperience: true, autoCrawl: true }, urlsTotal: 12, urlsCompleted: 4, passCount: 4, failCount: 0, avgPerformanceScore: 0.29 },
];

export const mockStaticResults: StaticResultRow[] = [
  { runId: '0408', timestamp: '2026-03-09 12:25:38', hostname: 'MBP-V7W25N293D', transaction: 'au/en/book/', pageUrl: 'https://www.virginaustralia.com/au/en/book/', fcp: 6239, lcp: 26508, tbt: 1120, cls: 0.067, speedIndex: 15442, performanceScore: 0.31, pageLoadTime: 7475, networkTime: 521, dnsLookupTime: 0, connectionTime: 490, serverProcessingTime: 35, responseTime: 583, browserTime: 6400, domInteractionTime: 1224, domCompleteTime: 6391, playwrightPageLoadTime: 7200, elementLoadTime: 'N/A', testStatus: 'PASS', failureReason: '' },
  { runId: '0408', timestamp: '2026-03-09 12:26:17', hostname: 'MBP-V7W25N293D', transaction: 'au-en/holidays', pageUrl: 'https://www.virginaustralia.com/au-en/holidays', fcp: 3715, lcp: 15189, tbt: 395, cls: 0.302, speedIndex: 10921, performanceScore: 0.34, pageLoadTime: 6064, networkTime: 413, dnsLookupTime: 0, connectionTime: 384, serverProcessingTime: 3, responseTime: 683, browserTime: 4962, domInteractionTime: 1029, domCompleteTime: 4960, playwrightPageLoadTime: 5800, elementLoadTime: 'N/A', testStatus: 'PASS', failureReason: '' },
  { runId: '0408', timestamp: '2026-03-09 12:28:17', hostname: 'MBP-V7W25N293D', transaction: 'pride-flight-2026', pageUrl: 'https://www.virginaustralia.com/au/en/book/pride-flight-2026/', fcp: 6126, lcp: 8443, tbt: 771, cls: 0.113, speedIndex: 8300, performanceScore: 0.36, pageLoadTime: 6667, networkTime: 585, dnsLookupTime: 0, connectionTime: 475, serverProcessingTime: 65, responseTime: 706, browserTime: 5437, domInteractionTime: 902, domCompleteTime: 5421, playwrightPageLoadTime: 6500, elementLoadTime: 'N/A', testStatus: 'PASS', failureReason: '' },
];

export const mockScriptedResults: ScriptedResultRow[] = [
  { runId: '0403', timestamp: '2026-03-03 12:19:30', transaction: 'TC01_LaunchToLogin', hostname: 'MBP-V7W25N293D', testStepName: 'Launch login page', request: 'Get:/web/index.php/auth/login', waitingElement: "//h5[normalize-space()='Login']", waitingElementLoadTime: '5397', playwrightPageLoadTime: '4735', testStatus: 'PASS', failureReason: '', pageLoadTime: '4735', fcp: '0', lcp: '0', performanceScore: '0' },
  { runId: '0403', timestamp: '2026-03-03 12:21:31', transaction: '', hostname: 'MBP-V7W25N293D', testStepName: 'Click on Login Button', request: 'Post:/web/index.php/dashboard/index', waitingElement: "//h5[normalize-space()='Login']", waitingElementLoadTime: '121563', playwrightPageLoadTime: '', testStatus: 'FAIL', failureReason: 'Element not Found', pageLoadTime: '0', fcp: '0', lcp: '0', performanceScore: '0' },
  { runId: '0403', timestamp: '2026-03-03 12:21:31', transaction: 'TC02_OHRM_Dashboard', hostname: 'MBP-V7W25N293D', testStepName: 'Wait for Dashboard', request: 'Get:/web/index.php/dashboard/index', waitingElement: "//h6[normalize-space()='Dashboard']", waitingElementLoadTime: '51', playwrightPageLoadTime: '1520', testStatus: 'PASS', failureReason: '', pageLoadTime: '1520', fcp: '0', lcp: '0', performanceScore: '0' },
];
