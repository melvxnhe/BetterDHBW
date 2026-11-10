// dev.html: the page with worst-case data sets behind a switcher at the
// bottom, for testing layouts (long titles, overlaps, empty weeks, …).
// Build only, and never deployed: dev.html stays out of public/.

import { esc, berlin, partsOf, mondayOf } from './render.js';

// Raw events (the API's shape) for a nasty three weeks, starting in the week of base's first event.
export function worstCase(base) {
  const monday = mondayOf(base.length ? partsOf(+new Date(base[0].startTime)) : { year: 2026, month: 11, day: 2 });
  let id = 1;
  const ev = (day, from, to, name, rooms = ['258B VL-Raum Unterrichtsraum'], type = 'PRESENCE') => {
    const d = new Date(+monday + day * 864e5);
    const at = (time) => { const [h, m] = time.split(':').map(Number); return new Date(berlin(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), h, m)).toISOString(); };
    return { id: id++, name, rooms, type, startTime: at(from), endTime: at(to) };
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

// goes into <head>
export const DEV_STYLE = `<style>
.devbar { position: fixed; left: 50%; bottom: calc(16px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%); z-index: 99;
  display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 8px; align-items: center; width: max-content; max-width: calc(100vw - 24px);
  padding: 6px; border-radius: 14px; background: #e5e5ea; font: 13px/1 system-ui, sans-serif; color: #1d1d1f; box-shadow: 0 4px 16px rgb(0 0 0 / .16); }
.devbar button { border: 0; border-radius: 9px; padding: 8px 11px; background: transparent; font: inherit; color: inherit; cursor: pointer; }
.devbar button[aria-pressed="true"] { background: #fff; font-weight: 600; }
</style>`;

// Goes before the page's script: each data set's <main> as a <template>, the
// switcher, and __devPick(name), which swaps one in. `fixtures`: { name: markup }.
export const devSwitcher = (fixtures) => `${Object.entries(fixtures).map(([name, html]) => `<template data-fixture="${esc(name)}">${html}</template>`).join('\n')}
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

// Goes after the page's script: ?data=<name> opens that data set right away.
export const DEV_START = `<script>if (new URLSearchParams(location.search).get('data')) window.__devPick(new URLSearchParams(location.search).get('data'));</script>`;
