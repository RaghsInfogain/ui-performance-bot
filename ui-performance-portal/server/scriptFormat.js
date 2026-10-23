/**
 * Shared column layout and helpers for static / scripted test case CSVs, plus
 * "page anchor" detection: a visible element (usually the main heading) whose
 * appearance confirms the page has loaded. Used by the crawler and recorder.
 */

export const STATIC_HEADERS = ['Transaction Name', 'Path Page URL', 'Element Identifier', 'Element Selector'];

export const SCRIPTED_HEADERS = [
  'Test_Case_Name', 'Transaction_Name', 'Test_Steps', 'Object_Name', 'Request', 'Selector',
  'Locator', 'Action', 'Parameter', 'Element to Wait', 'Element identifier', 'Frame_Selector',
];

export const BODY_ANCHOR = { identifier: 'XPath', selector: '//body' };

const MAX_TEXT_MATCH = 60;

/** Quote a string for use inside an XPath expression. */
export function xpathLiteral(text) {
  if (!text.includes("'")) return `'${text}'`;
  if (!text.includes('"')) return `"${text}"`;
  return `concat('${text.split("'").join(`', "'", '`)}')`;
}

/** XPath matching a tag by its visible text (exact when short, prefix-contains when long). */
export function xpathForText(tag, text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  if (clean.length <= MAX_TEXT_MATCH) return `//${tag}[normalize-space()=${xpathLiteral(clean)}]`;
  return `//${tag}[contains(normalize-space(),${xpathLiteral(clean.slice(0, 40).trim())})]`;
}

/** Locator strategy label for a selector: XPath for //… expressions, otherwise CSS. */
export function identifierFor(selector, xpathLabel = 'XPath') {
  const s = String(selector || '').trim();
  return s.startsWith('//') || s.startsWith('(//') || s.startsWith('xpath=') ? xpathLabel : 'CSS';
}

const HIDDEN_CLASS = /(sr-only|visually-hidden|screen-reader|hidden|offscreen)/i;

/** Pick a load-confirmation anchor from server-fetched HTML (cheerio). */
export function pickAnchorFromCheerio($) {
  const isHidden = (el) => {
    const $el = $(el);
    if ($el.closest('[hidden],[aria-hidden="true"],noscript,template').length) return true;
    return HIDDEN_CLASS.test($el.attr('class') || '');
  };
  for (const tag of ['h1', 'h2']) {
    for (const el of $(tag).toArray()) {
      if (isHidden(el)) continue;
      const id = $(el).attr('id');
      if (id) return { identifier: 'XPath', selector: `//${tag}[@id=${xpathLiteral(id)}]` };
      const xp = xpathForText(tag, $(el).text());
      if (xp) return { identifier: 'XPath', selector: xp };
    }
  }
  const mainId = $('main[id]').first().attr('id');
  if (mainId) return { identifier: 'XPath', selector: `//main[@id=${xpathLiteral(mainId)}]` };
  if ($('main').length) return { identifier: 'XPath', selector: '//main' };
  return BODY_ANCHOR;
}

/**
 * Same idea, evaluated inside a live browser page (recorder) — can check real visibility.
 * Passed to page.evaluate as a string so it runs in the page context.
 */
export const PAGE_ANCHOR_SCRIPT = `(() => {
  const MAX = ${MAX_TEXT_MATCH};
  const lit = (t) => !t.includes("'") ? "'" + t + "'" : (!t.includes('"') ? '"' + t + '"'
    : "concat('" + t.split("'").join("', \\"'\\", '") + "')");
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0;
  };
  for (const tag of ['h1', 'h2']) {
    for (const el of document.querySelectorAll(tag)) {
      if (!visible(el)) continue;
      if (el.id) return '//' + tag + '[@id=' + lit(el.id) + ']';
      const text = (el.textContent || '').replace(/\\s+/g, ' ').trim();
      if (!text) continue;
      return text.length <= MAX
        ? '//' + tag + '[normalize-space()=' + lit(text) + ']'
        : '//' + tag + '[contains(normalize-space(),' + lit(text.slice(0, 40).trim()) + ')]';
    }
  }
  const main = document.querySelector('main');
  if (main && visible(main)) return main.id ? '//main[@id=' + lit(main.id) + ']' : '//main';
  return '//body';
})()`;

const ASSET_EXT = /\.(pdf|jpe?g|png|gif|svg|webp|ico|zip|gz|rar|7z|mp4|mp3|mov|avi|docx?|xlsx?|pptx?|csv|xml|json|txt|css|js|woff2?|ttf|eot)$/i;

/** True for links that point at downloadable assets rather than HTML pages. */
export function isAssetUrl(url) {
  try { return ASSET_EXT.test(new URL(url).pathname); } catch { return false; }
}

/** Readable transaction name from a URL path, e.g. /us/en/g70-specs → G70_Specs; / → Home_Page. */
export function transactionNameFromUrl(url) {
  let parts = [];
  try {
    parts = new URL(url).pathname.split('/').filter(Boolean);
  } catch {
    return 'Page';
  }
  // Drop locale-ish segments (us, en, en-us, en_AU) so names reflect the page itself
  const meaningful = parts.filter((p) => !/^[a-z]{2}([-_][a-z]{2})?$/i.test(p));
  if (!meaningful.length) return 'Home_Page';
  const last = decodeURIComponent(meaningful[meaningful.length - 1])
    .replace(/\.(html?|aspx?|php|jsp)$/i, '');
  const name = last
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('_');
  return (name || 'Page').slice(0, 60);
}

/** Registrable-ish base domain (example.com, example.co.uk) for first-party checks. */
function baseDomain(hostname) {
  const parts = String(hostname || '').split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const sld = parts[parts.length - 2];
  return (sld.length <= 3 && parts.length >= 3 ? parts.slice(-3) : parts.slice(-2)).join('.');
}

/** True when a request goes to the same site as the page (ignores analytics / CDNs elsewhere). */
export function isFirstPartyRequest(requestUrl, pageUrl) {
  try {
    return baseDomain(new URL(requestUrl).hostname) === baseDomain(new URL(pageUrl).hostname);
  } catch {
    return false;
  }
}

/** Resource types that represent a call to the application server. */
export const SERVER_RESOURCE_TYPES = new Set(['document', 'xhr', 'fetch']);

/** Request column value for a captured request: Get:/page?x=1 for pages, Post:/api/path for API calls. */
export function formatRequest({ method, url, type }) {
  const m = String(method || 'GET').toLowerCase();
  const verb = m.charAt(0).toUpperCase() + m.slice(1);
  try {
    const u = new URL(url);
    return `${verb}:${u.pathname}${type === 'document' ? u.search : ''}`;
  } catch {
    return `${verb}:${url}`;
  }
}

/** The request that best represents an action: a page load, else a write (POST/PUT…), else the first call. */
export function primaryRequest(requests) {
  const list = requests ?? [];
  return list.find((r) => r.type === 'document')
    || list.find((r) => String(r.method).toUpperCase() !== 'GET')
    || list[0]
    || null;
}
