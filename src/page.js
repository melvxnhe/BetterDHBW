// The shell around every view: <head>, the header bar with the search, and
// the inlined CSS, data and script. Build only.

import { createHash } from 'node:crypto';

export const ICON_CAL = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M5 1a.75.75 0 0 1 .75.75V3h4.5V1.75a.75.75 0 0 1 1.5 0V3H13a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h1.25V1.75A.75.75 0 0 1 5 1ZM2.5 7v6c0 .28.22.5.5.5h10a.5.5 0 0 0 .5-.5V7h-11Z"/></svg>';
export const ICON_USER = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1.5a3.25 3.25 0 1 1 0 6.5 3.25 3.25 0 0 1 0-6.5ZM8 3a1.75 1.75 0 1 0 0 3.5A1.75 1.75 0 0 0 8 3ZM2.5 13.25C2.5 10.9 4.9 9.5 8 9.5s5.5 1.4 5.5 3.75v.5a.75.75 0 0 1-1.5 0v-.5C12 11.95 10.4 11 8 11s-4 .95-4 2.25v.5a.75.75 0 0 1-1.5 0v-.5Z"/></svg>';
export const ICON_SEARCH = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M7 1.5a5.5 5.5 0 0 1 4.38 8.82l3.15 3.15a.75.75 0 1 1-1.06 1.06l-3.15-3.15A5.5 5.5 0 1 1 7 1.5ZM3 7a4 4 0 1 0 8 0 4 4 0 0 0-8 0Z"/></svg>';

// - main, foot: the homepage's markup (the view the page starts with)
// - data: what the script reads from #course-data (every course, the preview's events)
// - css, script: inlined, so the page is one request
// - head, tail: extra markup for dev.html
export const pageHTML = ({ title, css, script, main, foot, data, head = '', tail = '' }) => `<!doctype html>
<html lang="de" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<title>${title}</title>
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/icon.svg" type="image/svg+xml">
<link rel="icon" href="icons/icon-192.png" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Stundenplan">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="description" content="Stundenpläne aller Kurse der DHBW Mannheim, live aus Rapla: Vorlesungen und Prüfungen der aktuellen Theoriephase.">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f5f5f7">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#000000">
<meta name="color-scheme" content="light dark">
<style>
${css}
</style>
${head}
</head>
<body data-view="home">
<header class="bar" id="top"><div class="wrap bar-inner">
<a class="brand" href="./" data-home><strong data-course-name>Stundenplan</strong><span>DHBW Mannheim</span></a>
<div class="search" role="search">
<label class="search-field">${ICON_SEARCH}<span class="visually-hidden">Kurs suchen</span>
<input id="course-search" type="search" placeholder="Kurs suchen, z. B. WWI26" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go"
 role="combobox" aria-expanded="false" aria-controls="course-list" aria-autocomplete="list" aria-describedby="course-search-hint"></label>
<span id="course-search-hint" class="visually-hidden">${data.courses.length} Kurse. Pfeiltasten zum Auswählen, Enter zum Öffnen.</span>
<ul id="course-list" class="search-list" role="listbox" aria-label="Kurse" hidden></ul>
</div>
<div class="bar-actions">
<a class="button" href="#" download data-ics>${ICON_CAL}<span class="button-label">Kalender laden</span></a>
<a class="button button-quiet" href="?konto" data-account-link hidden>${ICON_USER}<span class="button-label" data-account-label>Anmelden</span></a>
</div>
</div></header>
<main>
${main}
</main>
<footer class="foot">
${foot}
</footer>
${tail}
<script type="application/json" id="course-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
<script>
${script}
</script>
</body>
</html>
`;

// Content-Security-Policy for the shipped page: only its own inline style and
// script (by hash) and files from this site may run or load. A meta tag,
// because the hashes change with every build; frame-ancestors, which a meta
// tag can't carry, comes as a header from vercel.json.
export function withCsp(html) {
  const hashes = (re) => [...html.matchAll(re)].map((m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`).join(' ');
  const csp = [
    "default-src 'self'",
    `script-src 'self' ${hashes(/<script>([\s\S]*?)<\/script>/g)}`,
    `style-src 'self' ${hashes(/<style>([\s\S]*?)<\/style>/g)}`,
    "style-src-attr 'unsafe-inline'", // style="--cols: 5" and similar custom properties in the markup
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "frame-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'self'",
  ].join('; ');
  return html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${csp}">`);
}
