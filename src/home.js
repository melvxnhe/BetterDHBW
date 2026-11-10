// The homepage: hero with search and a live preview, the mensa slot, every
// course by faculty, and "how it works". Build only: the browser gets the
// finished markup and keeps a copy to come back to (see app.js).

import { esc, plural, partsOf, previewHTML, MONTHS } from './render.js';
import { directory } from './catalog.js';
import { ICON_SEARCH } from './page.js';

// ---------- drawings ----------

// a small deterministic random, so the diagram is the same on every build
const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

// "Von Rapla zu deiner Woche", drawn with the page's one shape, the square:
// scattered entries, squeezed into one course, laid out as a week of five
// days. Horizontal for wide screens, vertical for phones.
function diagram(vertical) {
  const W = vertical ? 300 : 1200, H = vertical ? 420 : 266, S = 12;
  const rnd = seeded(vertical ? 7 : 11);
  const sq = (x, y, cls, style = '') => `<rect class="${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${S}" height="${S}" rx="2"${style ? ` style="${style}"` : ''}/>`;
  const zones = vertical
    ? [[10, 0, 290, 120], [10, 140, 290, 260], [10, 280, 290, 420]]
    : [[0, 10, 380, 256], [410, 10, 790, 256], [820, 10, 1200, 256]];

  const scatter = [];
  for (let i = 0; i < 64; i++) {
    const [x0, y0, x1, y1] = zones[0];
    scatter.push(sq(x0 + rnd() * (x1 - x0 - S), y0 + rnd() * (y1 - y0 - S), i % 3 ? 'd-pale' : 'd-mid'));
  }

  const ribbon = [];
  const [rx0, ry0, rx1, ry1] = zones[1];
  if (vertical) {
    const cx = (rx0 + rx1) / 2 - S * 1.5 - 2;
    for (let r = 0; r * (S + 3) <= ry1 - ry0 - S; r++) for (let c = 0; c < 3; c++) ribbon.push(sq(cx + c * (S + 2), ry0 + r * (S + 3), 'd-ink'));
  } else {
    const cy = (ry0 + ry1) / 2 - S * 1.5 - 2;
    for (let c = 0; c * (S + 3) <= rx1 - rx0 - S; c++) for (let r = 0; r < 3; r++) ribbon.push(sq(rx0 + c * (S + 3), cy + r * (S + 2), 'd-ink'));
  }

  // five day columns; each session is a 3×2 block in its module colour
  const week = [];
  const days = [[0, 1], [5, 3], [2], [4, 3], [2, 6]];
  const [wx0, wy0, wx1] = zones[2];
  const colW = (wx1 - wx0) / 5;
  days.forEach((list, d) => list.forEach((m, k) => {
    const x = wx0 + d * colW + (colW - S * 3 - 4) / 2;
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
      week.push(sq(x + c * (S + 2), wy0 + k * (S * 2 + 14) + r * (S + 2), 'd-week', `fill:var(--m${m})`));
    }
  }));

  return `<svg class="how-diagram ${vertical ? 'is-vertical' : 'is-horizontal'}" viewBox="0 0 ${W} ${H}" aria-hidden="true">
${[scatter, ribbon, week].map((g, i) => `<g class="d-zone" data-reveal style="--i:${i}">${g.join('')}</g>`).join('\n')}
</svg>`;
}

// ---------- every course, by faculty and programme ----------

function programHTML(p) {
  const link = (c) => `<a class="course-link" href="?kurs=${encodeURIComponent(c.name)}" data-course-link="${esc(c.name)}"${c.full ? ` title="${esc(c.full)}"` : ''}>${esc(c.name)}</a>`;
  return `<li class="program" data-reveal>
<span class="program-mark" aria-hidden="true"></span>
<div class="program-body">
<p class="program-head"><b>${esc(p.code)}</b><span>${plural(p.count, 'Kurs', 'Kurse')}</span></p>
${p.degree ? `<p class="program-degree">${esc(p.degree)}</p>` : ''}
${p.years.map((y) => `<p class="program-year"><span class="year">${y.year}</span><span class="year-links">${y.courses.map(link).join(' ')}</span></p>`).join('\n')}
</div>
</li>`;
}

function facultyHTML(f) {
  return `<section class="faculty${f.programs.length < 3 ? ' is-small' : ''}" id="fakultaet-${f.id.toLowerCase()}" aria-labelledby="fak-${f.id}">
<h3 class="faculty-title" id="fak-${f.id}"><span>${esc(f.name)}</span><span class="faculty-count">${plural(f.count, 'Kurs', 'Kurse')}</span></h3>
<ul class="programs">
${f.programs.map(programHTML).join('\n')}
</ul>
</section>`;
}

// faculties with only one or two programmes share a row, so they don't leave half the screen empty
function facultiesHTML(dir) {
  const big = dir.filter((f) => f.programs.length >= 3), small = dir.filter((f) => f.programs.length < 3);
  return big.map(facultyHTML).join('\n') + (small.length ? `\n<div class="faculty-row">${small.map(facultyHTML).join('\n')}</div>` : '');
}

// ---------- the page ----------

export function homeHTML(courses, { sample, sampleEvents = [], now = Date.now() } = {}) {
  const dir = directory(courses);
  const programs = dir.reduce((n, f) => n + f.programs.length, 0);
  const preview = sample ? previewHTML(sample, sampleEvents, now) : '';
  return `<div class="home" data-enter>
<section class="hero wrap${preview ? '' : ' is-single'}" aria-labelledby="home-title">
<div class="hero-card">
<div class="square-band" aria-hidden="true">${'<i></i>'.repeat(48)}</div>
<div class="hero-body">
<h1 class="hero-title" id="home-title">Stundenpläne der <span class="nowrap">DHBW Mannheim</span></h1>
<p class="hero-lead">Alle ${courses.length} Kurse, live aus Rapla. Kürzel eingeben und die Woche sehen: was gerade läuft, in welchem Raum, und wann die nächste Klausur ist.</p>
<div class="search search-hero" role="search">
<label class="search-field">${ICON_SEARCH}<span class="visually-hidden">Kurs suchen</span>
<input id="hero-search" type="search" placeholder="Kürzel oder Studiengang, z. B. WWI26SEA" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go"
 role="combobox" aria-expanded="false" aria-controls="hero-list" aria-autocomplete="list"></label>
<button class="button search-go" type="button" data-search-go>Plan öffnen</button>
<ul id="hero-list" class="search-list" role="listbox" aria-label="Kurse" hidden></ul>
</div>
<p class="hero-links"><a href="#kurse">Alle Kurse</a><a href="#so-gehts">So funktioniert’s</a><button class="link-button" type="button" data-install hidden>Als App installieren</button><span class="hero-recent" data-recent hidden></span></p>
</div>
</div>
${preview ? `<div class="hero-stage" data-ui>${preview}</div>` : ''}
</section>

<section class="mensa wrap" data-mensa aria-labelledby="mensa-title" hidden></section>

<section class="directory wrap" id="kurse" aria-labelledby="kurse-title">
<header class="section-head" data-reveal>
<h2 class="section-title" id="kurse-title">Alle Kurse</h2>
<p class="section-lead">${courses.length} Kurse in ${programs} Studiengängen, nach Kürzel sortiert, die neuesten Jahrgänge zuerst. Ein Klick öffnet den Plan.</p>
</header>
${facultiesHTML(dir)}
</section>

<section class="how wrap" id="so-gehts" aria-labelledby="how-title">
<div class="how-head" data-reveal>
<h2 class="section-title" id="how-title">Von Rapla zu deiner Woche</h2>
<p class="section-lead">Rapla kennt jeden Termin jedes Kurses. Diese Seite holt nur deinen und ordnet ihn: eine Woche auf einen Blick, das Laufende oben, die Prüfungen am Ende.</p>
</div>
${diagram(false)}
${diagram(true)}
<ol class="how-steps">
<li data-reveal style="--i:0"><h3>Alle Termine</h3><p>Rapla führt die Vorlesungen, Klausuren und Räume aller ${courses.length} Mannheimer Kurse.</p></li>
<li data-reveal style="--i:1"><h3>Ein Kürzel</h3><p>WWI26SEA, TINF25CS1, WIB26A: das Kürzel deines Kurses reicht, Groß- und Kleinschreibung egal.</p></li>
<li data-reveal style="--i:2"><h3>Deine Woche</h3><p>Die Tage nebeneinander, was gerade läuft, jede Klausur mit Countdown und alles als Kalenderdatei.</p></li>
</ol>
</section>
</div>`;
}

// "MANNHEIM" built from blocks of different heights, letters knocked out
function blockmark() {
  const word = 'MANNHEIM';
  const W = 1200, H = 240, gap = 6, bw = (W - gap * (word.length - 1)) / word.length;
  const heights = [1, 0.78, 0.9, 0.66, 0.96, 0.72, 0.86, 1];
  const blocks = [...word].map((ch, i) => {
    const h = H * heights[i], x = i * (bw + gap), y = H - h;
    return `<mask id="bm${i}"><rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="#fff"/><text x="${(x + bw / 2).toFixed(1)}" y="${(H - 24).toFixed(1)}" text-anchor="middle" font-size="${(bw * 0.86).toFixed(0)}" font-weight="800" fill="#000">${ch}</text></mask>
<rect class="bm-block" mask="url(#bm${i})" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="6" style="fill:var(--m${i})"/>`;
  });
  return `<svg class="blockmark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Mannheim" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">${blocks.join('\n')}</svg>`;
}

export function homeFooterHTML(courses, { builtAt = Date.now() } = {}) {
  const p = partsOf(builtAt);
  const dir = directory(courses);
  return `<div class="wrap home-foot">
${blockmark()}
<div class="foot-cols">
<div><h2 class="foot-h">Fakultäten</h2>${dir.map((f) => `<p><a href="#fakultaet-${f.id.toLowerCase()}">${esc(f.name)}</a> <span class="foot-count">${f.count}</span></p>`).join('')}</div>
<div><h2 class="foot-h">Daten</h2><p>Aus Rapla der DHBW Mannheim, abgerufen über <a href="https://dhbw.app">dhbw.app</a>. Kursliste vom ${p.day}. ${MONTHS[p.month - 1]} ${p.year}.</p><p>Jeder Plan zeigt die ganze laufende Theoriephase, die vergangenen Wochen eingeschlossen.</p></div>
<div><h2 class="foot-h">App &amp; Kalender</h2><p>Als App: im Browser „App installieren“, auf dem iPhone Teilen → „Zum Home-Bildschirm“. Geöffnete Pläne gibt es dann auch offline.</p><p>Jeder Plan lässt sich außerdem als .ics-Datei in Outlook, Google oder Apple Kalender laden.</p></div>
<div><h2 class="foot-h">Hinweis</h2><p>Ein inoffizielles Projekt, nicht von der DHBW Mannheim betrieben. Verbindlich bleibt Rapla.</p></div>
</div>
<p class="foot-last"><span>Stundenpläne der DHBW Mannheim</span><a class="button button-small" href="#top">Nach oben</a></p>
</div>`;
}
