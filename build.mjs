// Builds the DHBW Mannheim timetable site from the live Rapla data.
//
//   node build.mjs                     fetch fresh data, then build
//   node build.mjs --offline           build from data/*.json
//   node build.mjs --course WWI26AWIA  another course for the homepage preview
//
// Writes public/index.html (the homepage with CSS and JS inlined: search,
// every Mannheim course, a live preview of one course) and dev.html
// (worst-case data sets behind a switcher, for testing only; it stays out of
// public/ so it is never deployed). Courses open at ?kurs=<name> and are
// fetched in the browser through /api, because api.dhbw.app does not allow
// cross-origin calls: the functions in api/ on Vercel, serve.mjs locally.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { normalize, courseList, mainHTML, homeHTML, homeFooterHTML, splitBlock, toWeeks, partsOf, hm, berlin, esc } from './src/render.js';

const API = 'https://api.dhbw.app';
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const COURSE = (arg('--course') || 'WWI26SEA').toUpperCase().replace(/^MA-+/, '');
const offline = process.argv.includes('--offline');

async function load(file, url) {
  if (offline) return JSON.parse(readFileSync(file, 'utf8'));
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`api.dhbw.app answered ${res.status} for ${url}`);
    const data = await res.json();
    mkdirSync('data', { recursive: true });
    writeFileSync(file, JSON.stringify(data));
    return data;
  } catch (err) {
    // a deploy shouldn't fail because the API is down: use the last saved copy
    if (!existsSync(file)) throw err;
    console.warn(`${err.message}; using ${file} from the last build`);
    return JSON.parse(readFileSync(file, 'utf8'));
  }
}

const courses = courseList(await load('data/courses.json', `${API}/courses`), await load('data/parsed.json', `${API}/courses/MA/parsed`));
const course = courses.find((c) => c.name === COURSE) || { name: COURSE, meta: '', full: '', ids: [`MA-${COURSE}`] };
// archived=true: the past weeks of the running theory phase too
const raw = await load('data/events.json', `${API}/rapla/lectures/${course.ids[0]}/events?archived=true`);
const builtAt = Date.now();
const events = normalize(raw);

// ---------- the page ----------

const css = readFileSync('src/styles.css', 'utf8');
// render.js runs in the browser too: same code, without the module syntax
const render = readFileSync('src/render.js', 'utf8').replace(/^export /gm, '');
const app = readFileSync('src/app.js', 'utf8');

const ICON_CAL = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M5 1a.75.75 0 0 1 .75.75V3h4.5V1.75a.75.75 0 0 1 1.5 0V3H13a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h1.25V1.75A.75.75 0 0 1 5 1ZM2.5 7v6c0 .28.22.5.5.5h10a.5.5 0 0 0 .5-.5V7h-11Z"/></svg>';
const ICON_SEARCH = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M7 1.5a5.5 5.5 0 0 1 4.38 8.82l3.15 3.15a.75.75 0 1 1-1.06 1.06l-3.15-3.15A5.5 5.5 0 1 1 7 1.5ZM3 7a4 4 0 1 0 8 0 4 4 0 0 0-8 0Z"/></svg>';

const page = ({ events, title, head = '', tail = '' }) => `<!doctype html>
<html lang="de" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
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
<span id="course-search-hint" class="visually-hidden">${courses.length} Kurse. Pfeiltasten zum Auswählen, Enter zum Öffnen.</span>
<ul id="course-list" class="search-list" role="listbox" aria-label="Kurse" hidden></ul>
</div>
<a class="button" href="#" download data-ics>${ICON_CAL}<span class="button-label">Kalender laden</span></a>
</div></header>
<main>
${homeHTML(courses, { sample: course.name, sampleEvents: events, now: builtAt })}
</main>
<footer class="foot">
${homeFooterHTML(courses, { builtAt })}
</footer>
${tail}
<script type="application/json" id="course-data">${JSON.stringify({ courses, sample: { name: course.name, raw: raw.map(({ id, name, startTime, endTime, rooms, type }) => ({ id, name, startTime, endTime, rooms, type })) } }).replace(/</g, '\\u003c')}</script>
<script>
(() => {
${render}
${app}
})();
</script>
</body>
</html>
`;

mkdirSync('public', { recursive: true });
writeFileSync('public/index.html', page({ events, title: 'Stundenpläne der DHBW Mannheim' }));

// ---------- dev page: worst-case data behind a toggle (break-ui) ----------

function worstCase(base) {
  const p = base.length ? partsOf(+new Date(base[0].startTime)) : { year: 2026, month: 11, day: 2 };
  const mon = new Date(Date.UTC(p.year, p.month - 1, p.day));
  mon.setUTCDate(mon.getUTCDate() - ((mon.getUTCDay() + 6) % 7));
  let id = 1;
  const ev = (day, from, to, name, rooms = ['258B VL-Raum Unterrichtsraum'], type = 'PRESENCE') => {
    const d = new Date(mon); d.setUTCDate(d.getUTCDate() + day);
    const [h1, m1] = from.split(':').map(Number), [h2, m2] = to.split(':').map(Number);
    return { id: id++, name, rooms, type,
      startTime: new Date(berlin(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), h1, m1)).toISOString(),
      endTime: new Date(berlin(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), h2, m2)).toISOString() };
  };
  return [
    // Monday: the longest realistic title, three rooms at once
    ev(0, '08:45', '13:15', 'Projektmanagement und Requirements Engineering in agilen Softwareentwicklungsprojekten (Gruppe A und B, inkl. Prüfungsvorleistung)', ['258B VL-Raum Unterrichtsraum', '180C VL-Raum Unterrichtsraum', 'E 101 Heinrich Vetter Saal']),
    ev(0, '15:30', '20:00', 'Grundlagen der Programmierung'),
    // Tuesday: five entries, two of them overlapping, one only 15 minutes, one very late
    ev(1, '07:30', '08:00', 'Grundlegende Konzepte der IT'),
    ev(1, '08:00', '08:15', 'Kurzvortrag'),
    ev(1, '10:00', '12:00', 'Mathematik I Gruppe A'),
    ev(1, '10:00', '12:00', 'Mathematik I Gruppe B', ['067C VL-Raum Unterrichtsraum']),
    ev(1, '18:00', '21:30', 'Effektives Lernen, Präsentieren und Kommunizieren'),
    // Wednesday: no room at all, and an online session
    ev(2, '09:15', '12:30', 'Begleitetes Selbststudium Mathematik I (MA-WWI26SEA)', []),
    ev(2, '13:30', '16:00', 'Grundlagen der Betriebswirtschaftslehre', ['MA Online-Veranstaltung'], 'ONLINE'),
    // Thursday: an event outside every module, with a long name
    ev(3, '16:30', '17:30', 'Vorstellung der Studierendenvertretung, Fachschaft Wirtschaftsinformatik & Ersti-Tutorien im Foyer'),
    // Friday: nothing. Saturday: a make-up session.
    ev(5, '09:00', '12:00', 'Grundlegende Methoden der Wirtschaftsinformatik (Nachholtermin)'),
    // week 2 stays empty; week 3 carries the exams
    ev(14, '10:00', '12:00', 'Klausur Grundlagen der Betriebswirtschaftslehre und Grundlagen des wissenschaftlichen Arbeitens (Wiederholungsprüfung)', ['E 101 Heinrich Vetter Saal', '180C VL-Raum Unterrichtsraum']),
    ev(16, '13:00', '15:00', 'Klausur Mathematik I'),
  ];
}

const fixtures = { 'Demo': events, 'Worst case': normalize(worstCase(raw)), 'Leer': [], 'Ein Termin': normalize(raw.slice(0, 1)) };

const devHead = `<style>
.devbar { position: fixed; left: 50%; bottom: calc(16px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%); z-index: 99;
  display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 8px; align-items: center; width: max-content; max-width: calc(100vw - 24px);
  padding: 6px; border-radius: 14px; background: #e5e5ea; font: 13px/1 system-ui, sans-serif; color: #1d1d1f; box-shadow: 0 4px 16px rgb(0 0 0 / .16); }
.devbar button { border: 0; border-radius: 9px; padding: 8px 11px; background: transparent; font: inherit; color: inherit; cursor: pointer; }
.devbar button[aria-pressed="true"] { background: #fff; font-weight: 600; }
</style>`;
const devTail = `${Object.entries(fixtures).map(([name, list]) => `<template data-fixture="${esc(name)}">${mainHTML(list, { course: course.name, full: course.full, now: builtAt })}</template>`).join('\n')}
<div class="devbar" role="group" aria-label="Testdaten (nur Entwicklung)">
${Object.keys(fixtures).map((n, i) => `<button type="button" data-fx="${esc(n)}" aria-pressed="${i === 0}">${esc(n)}</button>`).join('')}
</div>
<script>
(() => {
  const params = new URLSearchParams(location.search);
  window.__devPick = (name) => {
    const tpl = document.querySelector('template[data-fixture="' + name + '"]');
    if (!tpl) return;
    document.querySelector('main').innerHTML = tpl.innerHTML;
    document.body.dataset.view = 'course';
    document.querySelectorAll('[data-fx]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.fx === name)));
    params.set('data', name); history.replaceState(null, '', '?' + params + location.hash);
    window.__timetable && window.__timetable.start();
  };
  document.querySelectorAll('[data-fx]').forEach((b) => b.addEventListener('click', () => window.__devPick(b.dataset.fx)));
})();
</script>`;
const devStart = `<script>if (new URLSearchParams(location.search).get('data')) window.__devPick(new URLSearchParams(location.search).get('data'));</script>`;
writeFileSync('dev.html', page({ events, title: 'Stundenpläne der DHBW Mannheim (Testdaten)', head: devHead, tail: devTail })
  .replace('</body>', `${devStart}\n</body>`));

const { block } = splitBlock(events, builtAt);
console.log(`index.html: Startseite mit ${courses.length} Kursen, Vorschau ${course.name} (${block.length} Termine in ${toWeeks(block).length} Wochen) · Stand ${hm(partsOf(builtAt))} Uhr`);
