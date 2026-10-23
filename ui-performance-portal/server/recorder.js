import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  PAGE_ANCHOR_SCRIPT, identifierFor, isAssetUrl, isFirstPartyRequest, SERVER_RESOURCE_TYPES,
  formatRequest, primaryRequest,
} from './scriptFormat.js';

/**
 * Lightweight Playwright recorder (Selenium IDE–style).
 * Captures clicks, typing, selects, keys, and navigations with ranked locators
 * for high replay success (testid → id → name → aria → css → xpath).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(__dirname, '../..');
const REPLAY_REPORT_DIR = path.join(WORKSPACE_ROOT, 'Results', 'Replay_Reports');

/** @type {Map<string, {
 *   browser: import('playwright').Browser,
 *   page: import('playwright').Page,
 *   steps: object[],
 *   startedAt: number,
 *   startUrl: string,
 * }>} */
const sessions = new Map();

/** Live replay sessions for progressive pass/fail reporting */
const replaySessions = new Map();

const INIT_SCRIPT = `
(() => {
  if (window.__uiPerfRecorderInstalled) return;
  window.__uiPerfRecorderInstalled = true;

  const ATTR_PRIORITY = [
    'data-testid', 'data-test', 'data-cy', 'data-qa',
    'aria-label', 'name', 'placeholder', 'title', 'alt', 'role',
  ];

  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(String(value));
    return String(value).replace(/([ !"#$%&'()*+,./:;<=>?@[\\\\]^\`{|}~])/g, '\\\\$1');
  }

  function isUnique(selector) {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  }

  function xpathLiteral(text) {
    if (!text.includes("'")) return "'" + text + "'";
    if (!text.includes('"')) return '"' + text + '"';
    return "concat('" + text.split("'").join("',\\"'\\",'") + "')";
  }

  function getXPath(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) return '//*[@id=' + xpathLiteral(el.id) + ']';
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body && node !== document.documentElement) {
      let index = 1;
      let sibling = node.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === node.tagName) index += 1;
        sibling = sibling.previousElementSibling;
      }
      const tag = node.tagName.toLowerCase();
      parts.unshift(tag + '[' + index + ']');
      node = node.parentElement;
    }
    return '//' + parts.join('/');
  }

  function visibleText(el) {
    const t = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (!t || t.length > 60) return '';
    return t;
  }

  function buildLocators(el) {
    if (!el || !el.tagName) return { primary: { strategy: 'css', selector: 'body', score: 0 }, candidates: [] };
    const tag = el.tagName.toLowerCase();
    const candidates = [];

    const push = (strategy, selector, score, label) => {
      if (!selector) return;
      candidates.push({ strategy, selector, score, label, unique: strategy === 'xpath' ? true : isUnique(selector) });
    };

    for (const attr of ATTR_PRIORITY) {
      const val = el.getAttribute?.(attr);
      if (!val) continue;
      if (attr === 'data-testid' || attr === 'data-test' || attr === 'data-cy' || attr === 'data-qa') {
        push('css', '[' + attr + '="' + val.replace(/"/g, '\\\\"') + '"]', 100, attr);
      } else if (attr === 'name') {
        push('css', tag + '[name="' + val.replace(/"/g, '\\\\"') + '"]', 90, 'name');
      } else if (attr === 'aria-label') {
        push('css', tag + '[aria-label="' + val.replace(/"/g, '\\\\"') + '"]', 88, 'aria-label');
      } else if (attr === 'placeholder') {
        push('css', tag + '[placeholder="' + val.replace(/"/g, '\\\\"') + '"]', 85, 'placeholder');
      } else if (attr === 'role') {
        push('css', tag + '[role="' + val.replace(/"/g, '\\\\"') + '"]', 70, 'role');
      } else {
        push('css', tag + '[' + attr + '="' + val.replace(/"/g, '\\\\"') + '"]', 65, attr);
      }
    }

    if (el.id && !/^[0-9]/.test(el.id) && !/:/.test(el.id)) {
      push('css', '#' + cssEscape(el.id), 95, 'id');
    }

    const type = el.getAttribute?.('type');
    if (type) push('css', tag + '[type="' + type + '"]', 40, 'type');

    const text = visibleText(el);
    if (text && ['a', 'button', 'label', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'th'].includes(tag)) {
      push('xpath', '//' + tag + '[normalize-space()=' + xpathLiteral(text) + ']', 80, 'text');
      push('xpath', '//*[normalize-space()=' + xpathLiteral(text) + ']', 55, 'any-text');
    }

    const classes = (el.className && typeof el.className === 'string')
      ? el.className.trim().split(/\\s+/).filter((c) => c && !/^[0-9]/.test(c) && c.length < 40)
      : [];
    if (classes[0]) {
      push('css', tag + '.' + cssEscape(classes[0]), 45, 'class');
    }

    push('xpath', getXPath(el), 30, 'xpath-path');
    push('css', tag, 10, 'tag');

    candidates.sort((a, b) => {
      const au = a.unique ? 1 : 0;
      const bu = b.unique ? 1 : 0;
      if (bu !== au) return bu - au;
      return b.score - a.score;
    });

    const uniqueOnes = candidates.filter((c) => c.unique);
    const primary = uniqueOnes[0] || candidates[0] || { strategy: 'css', selector: tag, score: 0, label: 'fallback', unique: false };
    return {
      primary,
      candidates: candidates.slice(0, 8),
      tag,
      text: text.slice(0, 80),
      name: el.getAttribute?.('name') || '',
      id: el.id || '',
    };
  }

  function send(payload) {
    try {
      window.__uiPerfRecord?.(payload);
    } catch (_) { /* ignore */ }
  }

  let lastInputKey = '';
  let inputTimer = null;

  document.addEventListener('click', (e) => {
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    if (el.closest?.('[data-recorder-ui]')) return;
    const loc = buildLocators(el);
    const tag = loc.tag;
    send({
      kind: 'action',
      action: 'Click',
      selector: loc.primary.selector,
      locatorStrategy: loc.primary.strategy === 'xpath' ? 'Xpath' : 'CSS',
      locatorLabel: loc.primary.label,
      locatorCandidates: loc.candidates,
      testStep: 'Click ' + (loc.text || tag),
      elementIdentifier: loc.primary.selector,
      objectName: loc.name || loc.id || tag,
      pageUrl: location.href,
      tag,
      text: loc.text,
    });
  }, true);

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    const tag = el.tagName.toLowerCase();
    const loc = buildLocators(el);

    if (tag === 'select') {
      send({
        kind: 'action',
        action: 'SelectOption',
        selector: loc.primary.selector,
        locatorStrategy: loc.primary.strategy === 'xpath' ? 'Xpath' : 'CSS',
        locatorLabel: loc.primary.label,
        locatorCandidates: loc.candidates,
        parameter: el.value,
        testStep: 'Select ' + (el.options?.[el.selectedIndex]?.text || el.value),
        elementIdentifier: loc.primary.selector,
        objectName: loc.name || tag,
        pageUrl: location.href,
      });
      return;
    }

    if (tag === 'input' || tag === 'textarea') {
      const type = (el.type || '').toLowerCase();
      if (type === 'checkbox' || type === 'radio') {
        send({
          kind: 'action',
          action: el.checked ? 'Check' : 'Uncheck',
          selector: loc.primary.selector,
          locatorStrategy: loc.primary.strategy === 'xpath' ? 'Xpath' : 'CSS',
          locatorLabel: loc.primary.label,
          locatorCandidates: loc.candidates,
          parameter: '',
          testStep: (el.checked ? 'Check ' : 'Uncheck ') + (loc.name || tag),
          elementIdentifier: loc.primary.selector,
          objectName: loc.name || tag,
          pageUrl: location.href,
        });
        return;
      }
      send({
        kind: 'action',
        action: 'Set_Text',
        selector: loc.primary.selector,
        locatorStrategy: loc.primary.strategy === 'xpath' ? 'Xpath' : 'CSS',
        locatorLabel: loc.primary.label,
        locatorCandidates: loc.candidates,
        parameter: el.value,
        testStep: 'Enter text in ' + (loc.name || loc.id || tag),
        elementIdentifier: loc.primary.selector,
        objectName: loc.name || loc.id || tag,
        pageUrl: location.href,
        coalesceKey: loc.primary.selector,
      });
    }
  }, true);

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) return;
    const type = (el.type || '').toLowerCase();
    if (['checkbox', 'radio', 'button', 'submit', 'file'].includes(type)) return;
    const loc = buildLocators(el);
    lastInputKey = loc.primary.selector;
    clearTimeout(inputTimer);
    inputTimer = setTimeout(() => {
      send({
        kind: 'action',
        action: 'Set_Text',
        selector: loc.primary.selector,
        locatorStrategy: loc.primary.strategy === 'xpath' ? 'Xpath' : 'CSS',
        locatorLabel: loc.primary.label,
        locatorCandidates: loc.candidates,
        parameter: el.value,
        testStep: 'Enter text in ' + (loc.name || loc.id || loc.tag),
        elementIdentifier: loc.primary.selector,
        objectName: loc.name || loc.id || loc.tag,
        pageUrl: location.href,
        coalesceKey: lastInputKey,
      });
    }, 350);
  }, true);

  document.addEventListener('keydown', (e) => {
    if (!['Enter', 'Tab', 'Escape'].includes(e.key)) return;
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    const loc = buildLocators(el);
    send({
      kind: 'action',
      action: 'PressKey',
      selector: loc.primary.selector,
      locatorStrategy: loc.primary.strategy === 'xpath' ? 'Xpath' : 'CSS',
      locatorLabel: loc.primary.label,
      locatorCandidates: loc.candidates,
      parameter: e.key,
      testStep: 'Press ' + e.key,
      elementIdentifier: loc.primary.selector,
      objectName: loc.name || loc.tag,
      pageUrl: location.href,
    });
  }, true);
})();
`;

function pushStep(steps, step) {
  const enriched = { ...step, timestamp: Date.now() };

  // Coalesce rapid Set_Text on same field
  if (enriched.action === 'Set_Text' && enriched.coalesceKey) {
    for (let i = steps.length - 1; i >= 0; i -= 1) {
      const prev = steps[i];
      if (prev.action === 'Navigate') break;
      if (prev.action === 'Set_Text' && prev.coalesceKey === enriched.coalesceKey) {
        steps[i] = { ...prev, ...enriched };
        return;
      }
      if (prev.action !== 'Set_Text') break;
    }
  }

  // Skip duplicate consecutive Navigate to same URL
  if (enriched.action === 'Navigate') {
    const last = steps[steps.length - 1];
    if (last?.action === 'Navigate' && last.parameter === enriched.parameter) return;
  }

  steps.push(enriched);
}

function slugifyLabel(value, maxLen = 36) {
  const s = String(value || '')
    .replace(/https?:\/\//gi, '')
    .replace(/www\./gi, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  if (!s) return '';
  return s.slice(0, maxLen);
}

function pathHintFromUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    const path = u.pathname || '/';
    if (/\/auth\/login|\/login/i.test(path)) return 'Login';
    if (/dashboard/i.test(path)) return 'Dashboard';
    if (/admin/i.test(path)) return 'Admin';
    if (/pim|employee/i.test(path)) return 'Employee';
    if (/leave/i.test(path)) return 'Leave';
    if (/time|timesheet/i.test(path)) return 'Timesheet';
    if (/recruit/i.test(path)) return 'Recruitment';
    if (/myinfo|personal/i.test(path)) return 'MyInfo';
    const parts = path.split('/').filter(Boolean);
    if (!parts.length) return slugifyLabel(u.hostname.split('.')[0] || 'Home', 20);
    return slugifyLabel(parts.slice(-2).join('_'), 28);
  } catch {
    return slugifyLabel(url, 28);
  }
}

function objectHint(step) {
  const raw = step.objectName
    || step.locatorLabel
    || step.testStep
    || '';
  // Prefer readable words from test step like "Click Login button"
  const cleaned = String(raw)
    .replace(/^(Click|Set_Text|Enter|Type|Select|Navigate|Wait|Hover|Press)\s+(on\s+)?/i, '')
    .replace(/\b(button|link|field|input|to|the|a|an)\b/gi, ' ')
    .trim();
  return slugifyLabel(cleaned || raw, 28);
}

/**
 * Build a meaningful transaction name that describes the operation.
 * Examples: TC01_Navigate_Login, TC02_Click_Login, TC03_Load_Dashboard
 */
function buildMeaningfulTransactionName(step, txnCounter) {
  const existing = String(step.transactionName || '').trim();
  if (existing && !/^TC\d+_Recorded$/i.test(existing) && !/^TC\d+$/i.test(existing)) {
    return existing.slice(0, 80);
  }
  const pad = String(txnCounter).padStart(2, '0');
  const action = step.action || 'Step';
  const url = step.parameter || step.pageUrl || '';
  const req = String(step.request || '');

  if (action === 'Navigate') {
    const hint = pathHintFromUrl(url) || objectHint(step) || 'Page';
    return `TC${pad}_Navigate_${hint}`.slice(0, 80);
  }
  if (action === 'CalculateFullPageLoadTime') {
    const hint = pathHintFromUrl(url || req.replace(/^Get:/i, '')) || objectHint(step) || 'PageReady';
    return `TC${pad}_Load_${hint}`.slice(0, 80);
  }
  if (action === 'Click') {
    const hint = stepHint(step) || pathHintFromUrl(url) || 'Element';
    return `TC${pad}_Click_${hint}`.slice(0, 80);
  }
  if (action === 'Set_Text') {
    const hint = stepHint(step) || 'Input';
    return `TC${pad}_Enter_${hint}`.slice(0, 80);
  }
  if (action === 'SelectOption') {
    return `TC${pad}_Select_${objectHint(step) || 'Option'}`.slice(0, 80);
  }
  if (req) {
    const method = (req.split(':')[0] || 'Request').replace(/[^a-zA-Z]/g, '') || 'Request';
    const hint = objectHint(step) || pathHintFromUrl(req.replace(/^[A-Za-z]+:/, '')) || action;
    return `TC${pad}_${method}_${hint}`.slice(0, 80);
  }
  return `TC${pad}_${slugifyLabel(action) || 'Step'}_${objectHint(step) || 'Op'}`.slice(0, 80);
}

function requestPath(url) {
  try {
    const u = new URL(url);
    return `${u.pathname || '/'}${u.search}`;
  } catch {
    return url || '';
  }
}

const isUsableSelector = (sel) => {
  const v = String(sel || '').trim();
  return Boolean(v) && !/^NA$/i.test(v) && v !== 'body' && v !== '//body';
};

function isServerTimingStep(step) {
  const action = step.action;
  const request = String(step.request ?? '').trim();
  return action === 'Navigate'
    || action === 'CalculateFullPageLoadTime'
    || request.length > 0;
}

/** UI actions that can send a request to the server and load a new page. */
const TRIGGER_ACTIONS = new Set([
  'Click', 'PressKey', 'Set_Text', 'SelectOption', 'Check', 'Uncheck', 'ClickSwitchToNewTabAndGetText',
]);
/** How long after an action its server calls are still attributed to it. */
const ACTION_REQUEST_WINDOW_MS = 4000;

/** Steps that never trigger a navigation; skipped when looking for the trigger. */
const PASSIVE_ACTIONS = new Set(['ThinkTime', 'WaitForSelector', 'WaitUntilElementIsVisible', 'Hover', 'Get_Text']);

/** Navigate rows the recorder captured automatically (hand-written launch steps are left alone). */
const isRecordedNavigate = (step) => step?.action === 'Navigate'
  && /^Navigate to https?:\/\//i.test(String(step.testStep || ''));

/**
 * The scripted view lists only UI operations. A page load the recorder saw right after a
 * click / key press is the server request that action made, so fold it into that action:
 * the action gets Request = Get:/path and waits on the new page's anchor, and the
 * separate "Navigate to …" row is dropped. A navigation with no UI trigger (the launch,
 * or a redirect straight after it) stays a Navigate step.
 */
function foldRecordedNavigations(steps) {
  const out = [];
  let folded = false;
  for (const step of steps ?? []) {
    if (!isRecordedNavigate(step)) {
      out.push(step);
      continue;
    }
    const url = step.parameter || step.pageUrl || '';
    const anchor = isUsableSelector(step.anchorSelector) ? step.anchorSelector : '';
    let j = out.length - 1;
    while (j >= 0 && PASSIVE_ACTIONS.has(out[j].action)) j -= 1;
    const prev = out[j];
    if (prev && TRIGGER_ACTIONS.has(prev.action)) {
      // A later hop (e.g. a redirect after login) replaces the earlier destination
      out[j] = {
        ...prev,
        request: `Get:${requestPath(url)}`,
        navigatedTo: url,
        anchorSelector: anchor || (prev.navigatedTo ? prev.anchorSelector : '') || '',
        waitFromNavigate: anchor || (isUsableSelector(step.elementIdentifier) ? step.elementIdentifier : '') || prev.waitFromNavigate || '',
        foldedNow: true,
      };
      folded = true;
      continue;
    }
    if (prev && prev.action === 'Navigate' && j === out.length - 1) {
      // Redirect chain straight after a navigation: keep one step, measured to the final page
      out[j] = {
        ...prev,
        request: `Get:${requestPath(url)}`,
        anchorSelector: anchor || prev.anchorSelector || '',
        elementIdentifier: anchor || step.elementIdentifier || prev.elementIdentifier,
      };
      folded = true;
      continue;
    }
    out.push(step);
  }
  return { steps: out, folded };
}

/** After folding, number server-step transactions TC01, TC02… in order; name new ones. */
function renumberTransactions(rows) {
  let counter = 0;
  return rows.map((row) => {
    if (!isServerTimingStep(row)) return { ...row, transactionName: '' };
    counter += 1;
    const pad = String(counter).padStart(2, '0');
    const name = String(row.transactionName || '').trim();
    if (!name || /^TC\d+_Recorded$/i.test(name)) {
      return { ...row, transactionName: buildMeaningfulTransactionName({ ...row, transactionName: '' }, counter) };
    }
    return /^TC\d+_/i.test(name) ? { ...row, transactionName: name.replace(/^TC\d+_/i, `TC${pad}_`) } : row;
  });
}

/** Wait target for an action that loads a new page: that page's anchor, else the next element. */
function waitAfterNavigation(list, index) {
  const step = list[index];
  if (isUsableSelector(step.waitFromNavigate)) return step.waitFromNavigate;
  const next = list[index + 1];
  const sel = String(next?.selector || '').trim();
  return isUsableSelector(sel) && next?.action !== 'Navigate' ? sel : '//body';
}

/** Readable hint for a transaction from the step text, e.g. "Click Login" → Login. */
function stepHint(step) {
  const cleaned = String(step.testStep || '')
    .replace(/^(Click|Enter text in|Enter|Type|Select|Press|Check|Uncheck)\s+(on\s+)?/i, '')
    .replace(/\b(button|link|field|input|the|a|an)\b/gi, ' ')
    .trim();
  return slugifyLabel(cleaned, 28) || objectHint(step);
}

function toScriptedRows(steps, testCaseName) {
  const { steps: list } = foldRecordedNavigations((steps ?? []).filter((s) => s.action));
  // Load-complete confirmation for each step: the page anchor captured after a
  // navigation, else this step's element, else the next element on the same page.
  const pickWait = (step, index) => {
    if (step.action === 'Navigate' && isUsableSelector(step.anchorSelector)) return step.anchorSelector;
    // An action that just gained a page load waits for the new page, never the element it clicked
    if (step.foldedNow) return waitAfterNavigation(list, index);
    const explicit = String(step.elementIdentifier || step.selector || '').trim();
    if (isUsableSelector(explicit)) return explicit;
    for (let j = index + 1; j < Math.min(index + 6, list.length); j += 1) {
      const next = list[j];
      if (next.action === 'Navigate') break;
      const sel = String(next.selector || next.elementIdentifier || '').trim();
      if (isUsableSelector(sel)) return sel;
    }
    if (isUsableSelector(step.anchorSelector)) return step.anchorSelector;
    return '//body';
  };

  let txnCounter = 0;
  const rows = list.map((step, index) => {
    const action = step.action;
    const isNavigate = action === 'Navigate';
    const navUrl = step.parameter || step.pageUrl || '';
    const captured = primaryRequest(step.serverRequests);
    const request = isNavigate
      ? (/^Get:\//i.test(String(step.request ?? '')) ? step.request : `Get:${requestPath(navUrl)}`)
      : (step.request || (captured ? formatRequest(captured) : ''));
    const enriched = { ...step, request };
    const isServer = isServerTimingStep(enriched);
    if (isServer) txnCounter += 1;
    const waitSelector = pickWait(step, index);
    const selector = isNavigate ? 'NA' : (step.selector || 'NA');
    const locator = isNavigate || selector === 'NA'
      ? 'NA'
      : (step.locatorStrategy ?? step.locator ?? identifierFor(selector, 'Xpath'));
    return {
      testCaseName,
      transactionName: isServer
        ? buildMeaningfulTransactionName(enriched, txnCounter)
        : '',
      testStep: step.testStep ?? action,
      objectName: isNavigate ? 'URL' : (step.objectName || objectHint(step) || ''),
      request,
      selector,
      locator,
      action,
      parameter: isNavigate ? navUrl : (step.parameter ?? ''),
      elementToWait: identifierFor(waitSelector, 'Xpath'),
      elementIdentifier: waitSelector,
      frameSelector: step.frameSelector ?? '',
      locatorLabel: step.locatorLabel ?? '',
      locatorCandidates: step.locatorCandidates ?? [],
      pageUrl: step.pageUrl ?? '',
      anchorSelector: step.anchorSelector ?? '',
      navigatedTo: step.navigatedTo ?? '',
      waitFromNavigate: step.waitFromNavigate ?? '',
      serverRequests: step.serverRequests ?? [],
    };
  });
  return renumberTransactions(rows);
}

function toStaticRows(steps, startUrl) {
  const seen = new Set();
  const rows = [];
  const waitByUrl = new Map();

  const rememberWait = (url, selector) => {
    if (!url || !selector) return;
    const key = url.split('#')[0];
    const sel = String(selector).trim();
    if (!sel || /^NA$/i.test(sel)) return;
    if (!waitByUrl.has(key) || isBody(waitByUrl.get(key))) {
      waitByUrl.set(key, sel);
    }
  };

  const isBody = (sel) => !isUsableSelector(sel);
  for (const step of steps ?? []) {
    const pageUrl = step.pageUrl || (step.action === 'Navigate' ? step.parameter : '');
    if (step.action === 'Navigate' && isUsableSelector(step.anchorSelector)) {
      // Page anchor beats any element seen later on the page
      waitByUrl.set(String(pageUrl).split('#')[0], step.anchorSelector);
    }
  }
  for (const step of steps ?? []) {
    const pageUrl = step.pageUrl || (step.action === 'Navigate' ? step.parameter : '');
    const sel = step.action === 'Navigate' ? step.elementIdentifier : (step.selector || step.elementIdentifier);
    if (isUsableSelector(sel)) rememberWait(pageUrl, sel);
  }

  const add = (url, label) => {
    if (!url || url.startsWith('about:') || url.startsWith('chrome')) return;
    const key = url.split('#')[0];
    if (seen.has(key)) return;
    seen.add(key);
    const hint = pathHintFromUrl(url);
    let transactionName = '';
    if (label && !/^Navigate to /i.test(label) && !/^https?:/i.test(label)) {
      transactionName = slugifyLabel(label, 48);
    }
    if (!transactionName) {
      transactionName = hint ? `Open_${hint}` : `Page_${rows.length + 1}`;
    }
    if (rows.length === 0 && startUrl && key === String(startUrl).split('#')[0]) {
      transactionName = hint ? `Start_${hint}` : 'Start_Page';
    }
    const waitSel = waitByUrl.get(key) || '//body';
    rows.push({
      transactionName: String(transactionName).slice(0, 80),
      pageUrl: url,
      elementIdentifier: identifierFor(waitSel),
      elementSelector: waitSel,
    });
  };

  const destinationOf = (step) => {
    if (step.navigatedTo) return step.navigatedTo;
    const req = String(step.request || '');
    if (step.action !== 'Navigate' && /^Get:\//i.test(req) && step.pageUrl) {
      try { return new URL(req.slice(4), step.pageUrl).href; } catch { return ''; }
    }
    return '';
  };
  for (const step of steps ?? []) {
    const dest = destinationOf(step);
    if (dest && isUsableSelector(step.elementIdentifier)) rememberWait(dest, step.elementIdentifier);
  }

  if (startUrl) add(startUrl, 'Start_Page');
  for (const step of steps ?? []) {
    const dest = destinationOf(step);
    if (dest) add(dest, pathHintFromUrl(dest) ? `Open_${pathHintFromUrl(dest)}` : step.testStep);
    if (step.action === 'Navigate' && step.parameter) {
      add(step.parameter, pathHintFromUrl(step.parameter) ? `Open_${pathHintFromUrl(step.parameter)}` : step.testStep);
    } else if (step.pageUrl) add(step.pageUrl);
  }
  return rows;
}

/** Rebuild static + scripted previews from stored/edited steps. */
export function buildRecordingArtifacts(steps, name, startUrl) {
  const scripted = toScriptedRows(steps ?? [], name || 'Recorded_Flow');
  const staticRows = toStaticRows(steps ?? [], startUrl || '');
  return {
    scripted,
    static: staticRows,
    stepCount: scripted.length,
    urlCount: staticRows.length,
  };
}

/**
 * Bring saved scripted rows (e.g. from older recordings) up to the standard layout:
 * Navigate → Object_Name URL, Selector/Locator NA, Request Get:/path; placeholder
 * TCnn_Recorded transactions get meaningful names; Element to Wait matches its selector.
 * Values a user deliberately set are otherwise left alone.
 */
export function upgradeScriptedRows(rows) {
  const { steps: list } = foldRecordedNavigations((rows ?? []).filter((r) => r && typeof r === 'object'));
  const upgraded = list.map((row, index) => {
    const next = { ...row };
    if (next.foldedNow) {
      next.elementIdentifier = waitAfterNavigation(list, index);
      next.elementToWait = '';
      delete next.foldedNow;
    }
    if (next.action === 'Navigate') {
      const req = String(next.request ?? '').trim();
      const reqUrl = req.replace(/^get:\s*/i, '');
      if (!next.parameter && /^https?:\/\//i.test(reqUrl)) next.parameter = reqUrl;
      if (/^https?:\/\//i.test(reqUrl)) next.request = `Get:${requestPath(reqUrl)}`;
      else if (!req && next.parameter) next.request = `Get:${requestPath(next.parameter)}`;
      next.selector = 'NA';
      next.locator = 'NA';
      if (!next.objectName) next.objectName = 'URL';
    }
    const ident = String(next.elementIdentifier ?? '').trim();
    if (ident && /^(xpath|css)?$/i.test(String(next.elementToWait ?? '').trim())) {
      next.elementToWait = identifierFor(ident, 'Xpath');
    }
    const placeholder = /^TC(\d+)_Recorded$/i.exec(String(next.transactionName ?? ''));
    if (placeholder) {
      next.transactionName = buildMeaningfulTransactionName({ ...next, transactionName: '' }, Number(placeholder[1]));
    }
    return next;
  });
  return renumberTransactions(upgraded);
}

export { toScriptedRows, toStaticRows };

export async function startRecorder(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL');
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error('URL must start with http:// or https://');
  }

  const sessionId = `rec_${Date.now()}`;
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const steps = [];

  await page.exposeFunction('__uiPerfRecord', (payload) => {
    pushStep(steps, payload);
  });

  await page.addInitScript(INIT_SCRIPT);

  // After a navigation settles, record the page's anchor (main heading) on its Navigate step
  const captureAnchor = async (url) => {
    try {
      const anchor = await page.evaluate(PAGE_ANCHOR_SCRIPT);
      if (page.url() !== url || !anchor) return;
      for (let i = steps.length - 1; i >= 0; i -= 1) {
        const step = steps[i];
        if (step.action !== 'Navigate') continue;
        if (step.parameter === url && (!isUsableSelector(step.anchorSelector) || isUsableSelector(anchor))) {
          step.anchorSelector = anchor;
          step.elementIdentifier = anchor;
        }
        break;
      }
    } catch {
      /* page closed or navigating again */
    }
  };

  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      const url = frame.url();
      pushStep(steps, {
        action: 'Navigate',
        parameter: url,
        testStep: `Navigate to ${url}`,
        objectName: 'URL',
        selector: 'NA',
        locatorStrategy: 'NA',
        elementIdentifier: '//body',
        pageUrl: url,
        request: `Get:${requestPath(url)}`,
      });
      // SPA route changes don't fire 'load', so also sample after a short settle
      setTimeout(() => captureAnchor(url), 1500);
    }
  });

  page.on('load', () => {
    captureAnchor(page.url());
  });

  // Attribute server calls (XHR / fetch / sub-documents) to the UI action that triggered them.
  // Main-frame page loads are already captured as Navigate steps and folded later.
  page.on('request', (req) => {
    try {
      const type = req.resourceType();
      if (!SERVER_RESOURCE_TYPES.has(type)) return;
      if (type === 'document' && req.frame() === page.mainFrame()) return;
      const reqUrl = req.url();
      if (isAssetUrl(reqUrl) || !isFirstPartyRequest(reqUrl, page.url())) return;
      const last = steps[steps.length - 1];
      // Calls fired while a page is loading belong to that navigation, not to an action
      if (!last || !TRIGGER_ACTIONS.has(last.action)) return;
      if (Date.now() - (last.timestamp ?? 0) > ACTION_REQUEST_WINDOW_MS) return;
      last.serverRequests = [...(last.serverRequests ?? []), { method: req.method(), url: reqUrl, type }].slice(0, 10);
    } catch {
      /* page closing */
    }
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  sessions.set(sessionId, {
    browser,
    page,
    steps,
    startedAt: Date.now(),
    startUrl: url,
  });

  return {
    sessionId,
    message: 'Browser opened. Interact with the page — actions and element locators are recorded.',
    startUrl: url,
  };
}

export function getRecorderStatus(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return null;
  return {
    sessionId,
    stepCount: s.steps.length,
    active: true,
    startUrl: s.startUrl,
    startedAt: s.startedAt,
    steps: s.steps.map((step, index) => ({
      index,
      action: step.action,
      testStep: step.testStep,
      selector: step.selector,
      locatorStrategy: step.locatorStrategy,
      locatorLabel: step.locatorLabel,
      locatorCandidates: step.locatorCandidates ?? [],
      parameter: step.parameter ?? '',
      pageUrl: step.pageUrl ?? '',
      objectName: step.objectName ?? '',
    })),
  };
}

export async function stopRecorder(sessionId, testCaseName = 'Recorded_Flow', { persist = true } = {}) {
  const s = sessions.get(sessionId);
  if (!s) return null;

  const name = (testCaseName || 'Recorded_Flow').trim() || 'Recorded_Flow';
  // Prefer already-normalized scripted rows if caller edited live; otherwise build from raw
  const artifacts = buildRecordingArtifacts(s.steps, name, s.startUrl);

  try {
    await s.page?.close().catch(() => {});
  } catch {
    /* ignore */
  }
  try {
    await s.browser.close();
  } catch {
    /* already closed */
  }
  sessions.delete(sessionId);

  let recording = null;
  if (persist) {
    try {
      const { saveRecording } = await import('./recordingsStore.js');
      recording = await saveRecording({
        name,
        startUrl: s.startUrl,
        steps: artifacts.scripted,
        urlCount: artifacts.urlCount,
      });
    } catch (err) {
      console.error('Failed to persist recording:', err.message);
    }
  }

  return {
    testCaseName: name,
    steps: artifacts.scripted,
    scripted: artifacts.scripted,
    static: artifacts.static,
    stepCount: artifacts.stepCount,
    urlCount: artifacts.urlCount,
    recordingId: recording?.id ?? null,
    recording,
  };
}

export async function cancelRecorder(sessionId) {
  const s = sessions.get(sessionId);
  if (s) {
    try {
      await s.page?.close().catch(() => {});
    } catch {
      /* ignore */
    }
    try {
      await s.browser.close();
    } catch {
      /* ignore */
    }
    sessions.delete(sessionId);
  }
}

function normalizeSelector(selector, locator) {
  const sel = String(selector || '').trim();
  if (!sel || /^NA$/i.test(sel)) return null;
  const strategy = String(locator || '').toLowerCase();
  if (strategy.includes('xpath') || sel.startsWith('//') || sel.startsWith('(//')) {
    return sel.startsWith('xpath=') ? sel : `xpath=${sel}`;
  }
  return sel;
}

async function waitForLoadConfirm(page, step, timeout = 30000) {
  const waitSel = normalizeSelector(
    step.elementIdentifier || step.selector,
    step.locator || step.locatorStrategy || step.elementToWait,
  );
  await page.waitForLoadState('domcontentloaded', { timeout }).catch(() => {});
  if (waitSel) {
    await page.waitForSelector(waitSel, { state: 'visible', timeout }).catch(() => {
      return page.waitForSelector('body', { state: 'visible', timeout: 5000 });
    });
  } else {
    await page.waitForSelector('body', { state: 'visible', timeout: 5000 });
  }
}

/**
 * Wait until no requests are in flight and none started for QUIET_MS, after an initial grace
 * period (actions such as form submits often fire their call a few hundred ms later).
 */
async function waitForQuietNetwork(page, state, { graceMs = 700, quietMs = 500, maxMs = 5000 } = {}) {
  const start = Date.now();
  await page.waitForTimeout(graceMs).catch(() => {});
  while (Date.now() - start < maxMs) {
    const { inflight, lastNetworkActivity } = state();
    if (inflight === 0 && Date.now() - lastNetworkActivity >= quietMs) return;
    await page.waitForTimeout(100).catch(() => {});
  }
}

function ensureReplayReportDir() {
  fs.mkdirSync(REPLAY_REPORT_DIR, { recursive: true });
}

function escapeCsv(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeReplayReportHeader(csvPath) {
  fs.writeFileSync(
    csvPath,
    'Step,Status,Transaction,Action,Test Step,Selector,DurationMs,Error,Timestamp\n',
  );
}

function appendReplayReportRow(csvPath, entry) {
  const line = [
    entry.index + 1,
    entry.status,
    entry.transactionName || '',
    entry.action || '',
    entry.testStep || '',
    entry.selector || '',
    entry.durationMs ?? '',
    entry.error || '',
    entry.timestamp || new Date().toISOString(),
  ].map(escapeCsv).join(',');
  fs.appendFileSync(csvPath, `${line}\n`);
}

function snapshotReplay(session) {
  if (!session) return null;
  return {
    replayId: session.replayId,
    status: session.status,
    ok: session.failed === 0 && session.status === 'completed',
    passed: session.passed,
    failed: session.failed,
    skipped: session.skipped,
    total: session.total,
    currentStep: session.currentStep,
    results: session.results,
    reportPath: session.reportPath || '',
    reportCsv: session.reportCsv || '',
    reportJson: session.reportJson || '',
    startedAt: session.startedAt,
    endedAt: session.endedAt || null,
    error: session.error || '',
  };
}

export function getReplayStatus(replayId) {
  return snapshotReplay(replaySessions.get(replayId));
}

/**
 * Start a live replay that writes a pass/fail report as each step completes.
 * Poll GET status via getReplayStatus(replayId).
 */
export function startReplay({ startUrl, steps, headless = false, stepTimeout = 30000, name = 'Replay' } = {}) {
  if (!Array.isArray(steps) || !steps.length) {
    throw new Error('No steps to replay');
  }
  const replayId = `rp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  ensureReplayReportDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safeName = slugifyLabel(name, 40) || 'Replay';
  const reportCsv = path.join(REPLAY_REPORT_DIR, `${safeName}_${stamp}.csv`);
  const reportJson = path.join(REPLAY_REPORT_DIR, `${safeName}_${stamp}.json`);
  writeReplayReportHeader(reportCsv);

  const session = {
    replayId,
    status: 'running',
    passed: 0,
    failed: 0,
    skipped: 0,
    total: steps.length,
    currentStep: 0,
    results: [],
    reportPath: reportCsv,
    reportCsv,
    reportJson,
    startedAt: new Date().toISOString(),
    endedAt: null,
    error: '',
  };
  replaySessions.set(replayId, session);

  // Fire-and-forget execution; callers poll status
  replaySteps({
    startUrl,
    steps,
    headless,
    stepTimeout,
    name,
    reportPath: reportCsv,
    onStep: (entry) => {
      session.results = [...session.results, entry];
      session.currentStep = entry.index + 1;
      if (entry.status === 'PASS') session.passed += 1;
      else if (entry.status === 'FAIL') session.failed += 1;
      else if (entry.status === 'SKIP') session.skipped += 1;
    },
  }).then((final) => {
    session.status = 'completed';
    session.passed = final.passed;
    session.failed = final.failed;
    session.skipped = final.skipped;
    session.results = final.results;
    session.endedAt = new Date().toISOString();
    session.reportPath = final.reportPath || reportCsv;
    try {
      fs.writeFileSync(reportJson, JSON.stringify(snapshotReplay(session), null, 2));
    } catch {
      /* ignore */
    }
  }).catch((err) => {
    session.status = 'failed';
    session.error = err?.message || String(err);
    session.endedAt = new Date().toISOString();
    try {
      fs.writeFileSync(reportJson, JSON.stringify(snapshotReplay(session), null, 2));
    } catch {
      /* ignore */
    }
  });

  return snapshotReplay(session);
}

/**
 * Replay recorded/scripted steps in a headed browser to validate locators & flow.
 * Writes a CSV report row for each step as it completes when reportPath is set.
 * @returns {{ ok: boolean, passed: number, failed: number, results: object[], reportPath?: string }}
 */
export async function replaySteps({
  startUrl,
  steps,
  headless = false,
  stepTimeout = 30000,
  onStep,
  reportPath,
  name = 'Replay',
} = {}) {
  if (!Array.isArray(steps) || !steps.length) {
    throw new Error('No steps to replay');
  }

  ensureReplayReportDir();
  let csvPath = reportPath;
  if (!csvPath) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safeName = slugifyLabel(name, 40) || 'Replay';
    csvPath = path.join(REPLAY_REPORT_DIR, `${safeName}_${stamp}.csv`);
    writeReplayReportHeader(csvPath);
  }

  const browser = await chromium.launch({
    headless: !!headless,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const results = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let txnCounter = 0;

  // Server calls made while each step runs — lets the editor map actions to transactions
  let capturing = null;
  let inflight = 0;
  let lastNetworkActivity = 0;
  const settle = () => { inflight = Math.max(0, inflight - 1); lastNetworkActivity = Date.now(); };
  page.on('requestfinished', settle);
  page.on('requestfailed', settle);
  page.on('request', (req) => {
    inflight += 1;
    lastNetworkActivity = Date.now();
    if (!capturing) return;
    try {
      const type = req.resourceType();
      if (!SERVER_RESOURCE_TYPES.has(type)) return;
      const reqUrl = req.url();
      if (isAssetUrl(reqUrl) || !isFirstPartyRequest(reqUrl, page.url() || startUrl)) return;
      if (capturing.length < 20) capturing.push({ method: req.method(), url: reqUrl, type });
    } catch {
      /* ignore */
    }
  });

  const emit = (entry) => {
    results.push(entry);
    appendReplayReportRow(csvPath, entry);
    if (typeof onStep === 'function') {
      try { onStep(entry); } catch { /* ignore listener errors */ }
    }
  };

  try {
    const firstUrl = startUrl
      || steps.find((s) => s.action === 'Navigate')?.parameter
      || steps.find((s) => s.action === 'Navigate')?.pageUrl;
    if (firstUrl) {
      await page.goto(firstUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await waitForLoadConfirm(page, { elementIdentifier: 'body' }, stepTimeout);
    }

    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i];
      const action = step.action || '';
      const started = Date.now();
      if (isServerTimingStep(step)) txnCounter += 1;
      const transactionName = step.transactionName
        || (isServerTimingStep(step) ? buildMeaningfulTransactionName(step, txnCounter) : '');
      const entry = {
        index: i,
        action,
        testStep: step.testStep || action,
        transactionName,
        selector: step.selector || '',
        status: 'PASS',
        error: '',
        durationMs: 0,
        timestamp: new Date().toISOString(),
      };
      // The launch navigation's own page load isn't an action's server call
      capturing = i === 0 && action === 'Navigate' ? null : [];

      try {
        if (
          i === 0
          && action === 'Navigate'
          && firstUrl
          && (step.parameter === firstUrl || step.pageUrl === firstUrl)
        ) {
          await waitForLoadConfirm(page, step, stepTimeout);
          entry.durationMs = Date.now() - started;
          emit(entry);
          passed += 1;
          continue;
        }

        const selector = normalizeSelector(step.selector, step.locator || step.locatorStrategy);
        const param = step.parameter ?? '';

        switch (action) {
          case 'Navigate': {
            const url = param || step.pageUrl;
            if (!url) throw new Error('Navigate missing URL');
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            break;
          }
          case 'Click':
            if (!selector) throw new Error('Click missing selector');
            await page.click(selector, { timeout: stepTimeout });
            break;
          case 'Set_Text':
            if (!selector) throw new Error('Set_Text missing selector');
            await page.fill(selector, String(param), { timeout: stepTimeout });
            break;
          case 'SelectOption':
            if (!selector) throw new Error('SelectOption missing selector');
            await page.selectOption(selector, String(param), { timeout: stepTimeout });
            break;
          case 'Check':
            if (!selector) throw new Error('Check missing selector');
            await page.check(selector, { timeout: stepTimeout });
            break;
          case 'Uncheck':
            if (!selector) throw new Error('Uncheck missing selector');
            await page.uncheck(selector, { timeout: stepTimeout });
            break;
          case 'Hover':
            if (!selector) throw new Error('Hover missing selector');
            await page.hover(selector, { timeout: stepTimeout });
            break;
          case 'PressKey':
            if (selector) await page.press(selector, String(param || 'Enter'), { timeout: stepTimeout });
            else await page.keyboard.press(String(param || 'Enter'));
            break;
          case 'ThinkTime':
            await page.waitForTimeout(Math.min(Number(param) || 300, 10000));
            break;
          case 'WaitForSelector':
          case 'WaitUntilElementIsVisible':
            if (!selector) throw new Error(`${action} missing selector`);
            await page.waitForSelector(selector, { state: 'visible', timeout: stepTimeout });
            break;
          case 'CalculateFullPageLoadTime':
            await page.waitForLoadState('domcontentloaded', { timeout: stepTimeout }).catch(() => {});
            break;
          case 'Get_Text':
            if (selector) await page.textContent(selector, { timeout: stepTimeout });
            break;
          default:
            entry.status = 'SKIP';
            entry.error = `Unsupported in replay: ${action}`;
            entry.durationMs = Date.now() - started;
            emit(entry);
            skipped += 1;
            continue;
        }

        await waitForLoadConfirm(page, step, stepTimeout);
        entry.durationMs = Date.now() - started;
        // Let calls triggered by this action start and finish before moving on, so they're
        // attributed here: a short grace period, then wait for a quiet network (bounded).
        await waitForQuietNetwork(page, () => ({ inflight, lastNetworkActivity }));
        entry.requests = capturing ?? [];
        capturing = null;
        emit(entry);
        passed += 1;
      } catch (err) {
        entry.status = 'FAIL';
        entry.error = err?.message || String(err);
        entry.durationMs = Date.now() - started;
        entry.requests = capturing ?? [];
        capturing = null;
        emit(entry);
        failed += 1;
      }
    }
  } finally {
    try {
      await context.close();
    } catch {
      /* ignore */
    }
    try {
      await browser.close();
    } catch {
      /* ignore */
    }
  }

  const summary = {
    ok: failed === 0,
    passed,
    failed,
    skipped,
    total: results.length,
    results,
    reportPath: csvPath,
    reportCsv: csvPath,
  };
  try {
    const jsonPath = csvPath.replace(/\.csv$/i, '.json');
    fs.writeFileSync(jsonPath, JSON.stringify({
      ...summary,
      generatedAt: new Date().toISOString(),
      startUrl: startUrl || '',
    }, null, 2));
    summary.reportJson = jsonPath;
  } catch {
    /* ignore */
  }
  return summary;
}
