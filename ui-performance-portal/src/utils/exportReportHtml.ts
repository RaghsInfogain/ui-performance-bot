/**
 * Export the on-screen Website Performance Report as one self-contained HTML file.
 * The rendered report DOM (including the SVG charts) is saved together with the
 * page's own stylesheets, so the file looks exactly like the screen.
 */

/** All CSS the page uses. Cross-origin sheets (Google Fonts) can't be read and are linked instead. */
function collectCss(): { inline: string; links: string[] } {
  const inline: string[] = [];
  const links: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      inline.push(Array.from(sheet.cssRules).map((r) => r.cssText).join('\n'));
    } catch {
      if (sheet.href) links.push(sheet.href);
    }
  }
  return { inline: inline.join('\n'), links };
}

/** Rules only the exported file needs: no toolbar, charts that resize, working toggles. */
const EXPORT_CSS = `
  body { margin: 0; background: var(--rp-bg, #f1f5f9); }
  .run-report-export { max-width: 1280px; margin: 0 auto; padding: 24px 16px 48px; }
  .run-report__toolbar, [data-export-exclude] { display: none !important; }
  .recharts-responsive-container, .recharts-wrapper { width: 100% !important; height: auto !important; }
  .recharts-wrapper > svg.recharts-surface { width: 100%; height: auto; }
  .recharts-tooltip-wrapper { display: none !important; }
  .run-report__collapse-btn { cursor: pointer; }
  .run-report__collapse-btn svg { transition: transform 0.15s; }
  .run-report__collapse-btn[aria-expanded="false"] svg { transform: rotate(-90deg); }
  @media print { .run-report-export { padding: 0; } }
`;

/** Collapsible sections in the export: the button toggles the block right after it. */
const EXPORT_SCRIPT = `
  document.querySelectorAll('.run-report__collapse-btn').forEach(function (btn) {
    btn.setAttribute('aria-expanded', 'true');
    btn.addEventListener('click', function () {
      var panel = btn.nextElementSibling;
      if (!panel) return;
      var open = btn.getAttribute('aria-expanded') === 'true';
      panel.style.display = open ? 'none' : '';
      btn.setAttribute('aria-expanded', open ? 'false' : 'true');
    });
  });
`;

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

export function exportReportHtml(root: HTMLElement, { title, fileName }: { title: string; fileName: string }) {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.run-report__toolbar, [data-export-exclude]').forEach((el) => el.remove());

  // recharts fixes the SVG size in px; a viewBox lets it scale with the window
  clone.querySelectorAll<SVGSVGElement>('svg.recharts-surface').forEach((svg) => {
    const w = svg.getAttribute('width');
    const h = svg.getAttribute('height');
    if (w && h && !svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  });

  const { inline, links } = collectCss();
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
${links.map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}" />`).join('\n')}
<style>
${inline}
${EXPORT_CSS}
</style>
</head>
<body>
<main class="run-report-export">
${clone.outerHTML}
</main>
<script>${EXPORT_SCRIPT}</script>
</body>
</html>
`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
