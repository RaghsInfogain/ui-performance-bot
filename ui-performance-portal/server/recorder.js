import { chromium } from 'playwright';

/** @type {Map<string, { browser: import('playwright').Browser, page: import('playwright').Page, steps: object[], startedAt: number }>} */
const sessions = new Map();

function buildSelector(el) {
  if (!el) return '';
  const tag = el.tagName?.toLowerCase();
  if (el.id) return `#${el.id}`;
  if (el.getAttribute('data-testid')) return `[data-testid="${el.getAttribute('data-testid')}"]`;
  if (el.name) return `${tag}[name="${el.name}"]`;
  if (el.placeholder) return `${tag}[placeholder="${el.placeholder}"]`;
  const cls = el.className?.toString().trim().split(/\s+/).filter(Boolean)[0];
  if (cls) return `${tag}.${cls}`;
  return tag;
}

export async function startRecorder(url) {
  const sessionId = `rec_${Date.now()}`;
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const steps = [];

  await page.exposeFunction('__uiPerfRecord', (payload) => {
    steps.push({ ...payload, timestamp: Date.now() });
  });

  await page.addInitScript(() => {
    const send = (payload) => window.__uiPerfRecord?.(payload).catch(() => {});

    document.addEventListener('click', (e) => {
      const el = e.target;
      if (!el || el.closest('[data-recorder-ui]')) return;
      const tag = el.tagName?.toLowerCase();
      let selector = '';
      if (el.id) selector = `#${el.id}`;
      else if (el.getAttribute('data-testid')) selector = `[data-testid="${el.getAttribute('data-testid')}"]`;
      else if (el.name) selector = `${tag}[name="${el.name}"]`;
      else if (el.placeholder) selector = `${tag}[placeholder="${el.placeholder}"]`;
      else selector = tag;

      send({
        action: 'Click',
        selector,
        testStep: `Click ${tag}`,
        elementIdentifier: selector,
      });
    }, true);

    document.addEventListener('change', (e) => {
      const el = e.target;
      if (!el || el.tagName?.toLowerCase() !== 'input') return;
      const tag = el.tagName.toLowerCase();
      let selector = el.id ? `#${el.id}` : `${tag}[name="${el.name}"]`;
      send({
        action: el.type === 'checkbox' ? 'Check' : 'Set_Text',
        selector,
        parameter: el.value,
        testStep: `Input ${el.name || tag}`,
        elementIdentifier: selector,
      });
    }, true);
  });

  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      steps.push({
        action: 'Navigate',
        parameter: frame.url(),
        testStep: `Navigate to ${frame.url()}`,
        selector: 'NA',
        elementIdentifier: 'body',
      });
    }
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  sessions.set(sessionId, { browser, page, steps, startedAt: Date.now(), testCaseName: 'Recorded_Flow' });
  return { sessionId, message: 'Browser opened. Interact with the page — clicks and inputs are recorded.' };
}

export function getRecorderStatus(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return null;
  return { sessionId, stepCount: s.steps.length, active: true };
}

export async function stopRecorder(sessionId, testCaseName = 'Recorded_Flow') {
  const s = sessions.get(sessionId);
  if (!s) return null;

  const scriptedSteps = s.steps.map((step, i) => ({
    testCaseName,
    transactionName: i === 0 ? 'TC01_Recorded' : '',
    testStep: step.testStep ?? step.action,
    objectName: '',
    request: step.action === 'Navigate' ? `Get:${step.parameter}` : '',
    selector: step.selector ?? 'NA',
    locator: 'Xpath',
    action: step.action,
    parameter: step.parameter ?? '',
    elementToWait: 'Xpath',
    elementIdentifier: step.elementIdentifier ?? step.selector ?? 'body',
    frameSelector: '',
  }));

  await s.browser.close();
  sessions.delete(sessionId);
  return { testCaseName, steps: scriptedSteps };
}

export async function cancelRecorder(sessionId) {
  const s = sessions.get(sessionId);
  if (s) {
    await s.browser.close();
    sessions.delete(sessionId);
  }
}
