// The course page in the other layouts, each a structure of its own rather
// than the standard page restyled: the Abfahrtstafel as a station's departure
// boards, the Plakat as a Swiss typographic poster, Tageslicht as a sundial
// over the day. courseHTML() picks the one the settings ask for; the
// standard layout stays mainHTML() in render.js.
//
// Browser only (the page script, after render.js, whose helpers it uses).
// Every view carries the hooks timetable.js and account.js look for, so the
// live state, the week tabs, the module filter and the notes work in all of
// them: [data-ev] entries with [data-time], [data-title], [data-meta],
// [data-status] and [data-progress]; [data-date] days with [data-dayname];
// [data-exam] with [data-countdown]; [data-now] with its parts; [data-filter];
// a [role=tablist] of week tabs over [role=tabpanel] weeks.

function courseHTML(events, opts) {
  const layout = document.documentElement.dataset.layout;
  if (layout === 'tafel') return tafelHTML(events, opts);
  if (layout === 'plakat') return plakatHTML(events, opts);
  if (layout === 'tageslicht') return lichtHTML(events, opts);
  return mainHTML(events, opts);
}

// ---------- what every view needs ----------

// the block on screen, its weeks, exams, modules (most frequent first) and a few facts
function viewData(events, now) {
  const { block } = splitBlock(events, now);
  const weeks = toWeeks(block);
  const modules = new Map();
  block.forEach((e) => { if (!modules.has(e.module)) modules.set(e.module, { name: e.moduleName, n: 0 }); modules.get(e.module).n++; });
  const lectures = block.filter((e) => !e.exam);
  const rooms = {};
  lectures.forEach((e) => { if (e.room) rooms[e.room] = (rooms[e.room] || 0) + 1; });
  const [mainRoom, roomCount] = Object.entries(rooms).sort((a, b) => b[1] - a[1])[0] || [];
  const first = block[0] && partsOf(block[0].start), last = block.length && partsOf(block.at(-1).start);
  return {
    block, weeks,
    exams: block.filter((e) => e.exam),
    modules: [...modules].filter(([id]) => id !== 'misc').sort((a, b) => b[1].n - a[1].n),
    room: mainRoom && lectures.length >= 4 && roomCount >= lectures.length * 0.6 ? mainRoom : '',
    range: first ? `${longDate(first)}${first.year !== last.year ? ` ${first.year}` : ''} – ${longDate(last)} ${last.year}` : '',
    hours: block.reduce((sum, e) => sum + e.hours, 0),
    current: weeks.find((w) => now < w.end) || weeks.at(-1),
  };
}

// the attributes that make an element an entry for timetable.js and account.js
const evAttrs = (e) => `data-ev data-id="${esc(String(e.id ?? ''))}" data-module="${e.module}" data-start="${e.start}" data-end="${e.end}" data-room="${esc(e.room)}" title="${esc(e.name)}"`;
const panelAttrs = (w) => `id="${w.id}" role="tabpanel" aria-labelledby="tab-${w.id}" data-start="${w.start}" data-end="${w.end}"`;
const tabAttrs = (w, now) => `role="tab" id="tab-${w.id}" href="#${w.id}" aria-controls="${w.id}" aria-selected="false"`;
const matchLink = (course, text) => `<a href="?frei=${encodeURIComponent(course)}" data-match-link="${esc(course)}">${text}</a>`;
const mensaSlot = '<section class="mensa" data-mensa aria-labelledby="mensa-title" hidden></section>';
const dayLabel = (d) => `${d.day}. ${MON_SHORT[d.month - 1]}`;
const emptyCourse = '<p class="view-empty">In Rapla sind für diesen Kurs keine Termine eingetragen. Vielleicht ist er schon fertig, oder noch nicht im Plan.</p>';

// =====================================================================
// Abfahrtstafel: one departure board per day. Time in split flaps, the
// module as a line badge (S1, S2 … like the S-Bahn), the lecture as the
// destination, the room as the platform, a column for what is going on.
// =====================================================================

// "S1" for the most frequent module, "S2" for the next …; one-off events are "Info"
const tafelLine = (module) => (module === 'misc' ? 'Info' : `S${+module.slice(1) + 1}`);

// "08:45" as flaps: two digits, the colon, two digits (the text reads "08:45")
const flaps = (text) => text.split(/(:)/).map((part) => (part === ':' ? '<span class="tf-colon">:</span>' : [...part].map((ch) => `<span class="tf-flap">${esc(ch)}</span>`).join(''))).join('');

function tafelRow(e) {
  const [from, to] = spanParts(e.start, e.end);
  const timed = /^\d\d:\d\d$/.test(from);
  return `<li class="tf-row" ${evAttrs(e)}>
<span class="tf-time" data-time>${timed ? flaps(from) : `<span class="tf-allday">${esc(from)}</span>`}</span>
<span class="tf-line" style="--c: var(--${e.module === 'misc' ? 'm-misc' : /^m\d$/.test(e.module) ? e.module : 'm-misc'})">${tafelLine(e.module)}</span>
<span class="tf-dest"><b class="tf-title" data-title>${title(e.name)}</b><span class="tf-via" data-meta>${esc([to ? `bis ${to}` : '', hours(e.hours), e.exam ? e.exam : ''].filter(Boolean).join(' · '))}</span><span class="tf-notes" data-note-slot></span></span>
<span class="tf-gleis" aria-label="Raum ${esc(e.room || 'offen')}">${esc(e.room.replace(/^Raum /, '') || '–')}</span>
<span class="tf-hint" data-status></span>
<i class="tf-progress" data-progress aria-hidden="true"></i>
</li>`;
}

function tafelHTML(events, { course, full = '', now = Date.now() } = {}) {
  const v = viewData(events, now);
  const nextExam = v.exams.find((e) => e.end > now);
  const ticker = [
    v.range && `Theoriephase ${v.range}`,
    v.room && `Fast alle Vorlesungen in ${v.room}`,
    nextExam && `Nächste Prüfung: ${nextExam.name}, ${weekdayOf(partsOf(nextExam.start))} ${longDate(partsOf(nextExam.start))}`,
    v.block.length && `${plural(v.block.length, 'Termin', 'Termine')} in diesem Block`,
    'Alle Angaben ohne Gewähr, verbindlich ist Rapla',
  ].filter(Boolean);
  const next = v.block.find((e) => e.end > now);

  return `<div class="view v-tafel">
<header class="tf-head wrap">
<div class="tf-station">
<p class="tf-kicker">Abfahrt</p>
<h1 class="tf-name" id="page-title">${esc(course)}</h1>
${full ? `<p class="tf-full">${esc(full)}</p>` : ''}
</div>
<p class="tf-clock" data-clock aria-hidden="true"></p>
</header>
${ticker.length ? `<div class="tf-ticker" aria-hidden="true"><p>${ticker.map((t) => `<span>${esc(t)}</span>`).join('')}${ticker.map((t) => `<span class="tf-again">${esc(t)}</span>`).join('')}</p></div>` : ''}
<div class="wrap">
${next ? `<section class="tf-next" data-now aria-label="Nächste Abfahrt" aria-live="polite">
<p class="tf-next-label" data-now-label>Als Nächstes</p>
<h2 class="tf-next-title" data-now-title>${title(next.name)}</h2>
<p class="tf-next-meta" data-now-meta></p>
<p class="tf-next-rel" data-now-rel></p>
<div class="tf-next-bar" data-now-bar hidden><i data-progress></i></div>
</section>` : ''}
<p class="tf-link">${matchLink(course, 'Anschluss suchen: Freistunden mit einem anderen Kurs')}</p>
${v.weeks.length ? `<nav class="tf-weeks" data-tabs-scroll aria-label="Wochen"><div class="tf-tablist" role="tablist" aria-label="Woche wählen">
${v.weeks.map((w) => `<a class="tf-tab" ${tabAttrs(w, now)}><span>KW</span><b>${w.kw}</b><small>${w.range}</small></a>`).join('')}
</div></nav>
${v.modules.length ? `<div class="tf-lines" role="group" aria-label="Nach Modul filtern"><button class="tf-chip" type="button" data-filter="all" aria-pressed="true">Alle Linien</button>${v.modules.map(([id, m]) => `<button class="tf-chip" type="button" data-filter="${id}" aria-pressed="false" title="${esc(m.name)}"><span class="tf-line" style="--c: var(--${/^m\d$/.test(id) ? id : 'm-misc'})">${tafelLine(id)}</span>${esc(m.name)}</button>`).join('')}</div>` : ''}
<div class="tf-weekpanels">
${v.weeks.map((w) => `<section class="tf-week" ${panelAttrs(w)}>
<h2 class="tf-week-title">Fahrplan ${w.title}</h2>
${w.days.map((d) => `<section class="tf-board" data-date="${d.key}" aria-labelledby="tf${d.key}">
<h3 class="tf-board-head" id="tf${d.key}"><span data-dayname>${d.weekday}</span> <span class="tf-board-date">${dayLabel(d)}</span><span class="tf-today">Heute</span></h3>
${d.events.length ? `<div class="tf-cols" aria-hidden="true"><span>Zeit</span><span>Linie</span><span>Vorlesung</span><span>Raum</span><span>Hinweis</span></div>
<ol class="tf-rows">${d.events.map(tafelRow).join('')}</ol>` : '<p class="tf-none">Keine Abfahrten</p>'}
</section>`).join('\n')}
</section>`).join('\n')}
</div>
<section class="tf-special" aria-labelledby="tf-special-title">
<h2 class="tf-section-title" id="tf-special-title">Sonderfahrten: Prüfungen</h2>
${v.exams.length ? `<ol class="tf-rows tf-exams">${v.exams.map((e) => { const s = partsOf(e.start); return `<li class="tf-row tf-exam" data-exam data-start="${e.start}" data-end="${e.end}">
<span class="tf-time"><span class="tf-flap">${String(s.day).padStart(2, '0')[0]}</span><span class="tf-flap">${String(s.day).padStart(2, '0')[1]}</span><span class="tf-colon">.</span><span class="tf-flap tf-flap-wide">${MON_SHORT[s.month - 1]}</span></span>
<span class="tf-dest"><b class="tf-title">${title(e.name)}</b><span class="tf-via">${weekdayOf(s)}, ${spanText(e.start, e.end)}</span></span>
<span class="tf-gleis">${esc(e.room.replace(/^Raum /, '') || '–')}</span>
<span class="tf-hint" data-countdown></span>
</li>`; }).join('')}</ol>` : '<p class="tf-none">Keine Prüfungen in diesem Block.</p>'}
</section>` : emptyCourse}
${mensaSlot}
</div>
</div>`;
}

// =====================================================================
// Plakat: a Swiss poster. The course code as the headline at full width,
// a red disc with the week, facts in narrow columns; each day a band with
// its giant two-letter name; the exams counted down in large figures.
// =====================================================================

function plakatItem(e) {
  const [from, to] = spanParts(e.start, e.end);
  return `<li class="pk-item" ${evAttrs(e)}>
<p class="pk-time" data-time>${esc(from)}${to ? ` – ${esc(to)}` : ''}</p>
<div class="pk-what">
${e.exam ? `<p class="pk-tag">${esc(e.exam)}</p>` : ''}<h4 class="pk-title" data-title>${title(e.name)}</h4>
<p class="pk-meta" data-meta>${esc([e.room, hours(e.hours)].filter(Boolean).join(' · '))}</p>
<p class="pk-status" data-status></p>
</div>
<i class="pk-bar" data-progress aria-hidden="true"></i>
</li>`;
}

function plakatHTML(events, { course, full = '', now = Date.now() } = {}) {
  const v = viewData(events, now);
  const [, head = course, tail = ''] = course.match(/^([A-Z]+)(.*)$/) || [];
  const next = v.block.find((e) => e.end > now);
  return `<div class="view v-plakat">
<header class="pk-mast wrap">
<h1 class="pk-code${course.length > 9 ? ' is-long' : ''}" id="page-title"><span>${esc(head)}</span>${tail ? `<span>${esc(tail)}</span>` : ''}</h1>
${v.current ? `<p class="pk-disc" aria-label="Kalenderwoche ${v.current.kw}"><span>KW</span><b>${v.current.kw}</b></p>` : ''}
<dl class="pk-facts">
${full ? `<div><dt>Studiengang</dt><dd>${esc(full)}</dd></div>` : ''}
${v.range ? `<div><dt>Theoriephase</dt><dd>${esc(v.range)}</dd></div>` : ''}
${v.room ? `<div><dt>Raum</dt><dd>Fast alles in ${esc(v.room)}</dd></div>` : ''}
${v.block.length ? `<div><dt>Umfang</dt><dd>${plural(v.block.length, 'Termin', 'Termine')}, ${hours(v.hours)}</dd></div>` : ''}
</dl>
<p class="pk-link">${matchLink(course, 'Freistunden mit einem anderen Kurs →')}</p>
</header>
<div class="wrap">
${next ? `<section class="pk-now" data-now aria-label="Aktueller Termin" aria-live="polite">
<p class="pk-now-label" data-now-label>Als Nächstes</p>
<h2 class="pk-now-title" data-now-title>${title(next.name)}</h2>
<p class="pk-now-meta" data-now-meta></p>
<p class="pk-now-rel" data-now-rel></p>
<div class="pk-now-bar" data-now-bar hidden><i data-progress></i></div>
</section>` : ''}
${v.weeks.length ? `<nav class="pk-weeks" data-tabs-scroll aria-label="Wochen"><div class="pk-tablist" role="tablist" aria-label="Woche wählen">
${v.weeks.map((w) => `<a class="pk-tab" ${tabAttrs(w, now)}><b>${w.kw}</b><span>${w.range}</span></a>`).join('')}
</div></nav>
<div class="pk-body">
${v.modules.length ? `<div class="pk-index" role="group" aria-label="Nach Modul filtern">
<p class="pk-index-title">Module</p>
<button class="pk-entry" type="button" data-filter="all" aria-pressed="true"><span>Alle</span><b>${v.block.length}</b></button>
${v.modules.map(([id, m]) => `<button class="pk-entry" type="button" data-filter="${id}" aria-pressed="false"><span>${esc(m.name)}</span><b>${m.n}</b></button>`).join('')}
</div>` : ''}
<div class="pk-weekpanels">
${v.weeks.map((w) => `<section class="pk-week" ${panelAttrs(w)}>
<h2 class="pk-week-title">${w.title}</h2>
${w.days.map((d) => `<section class="pk-day" data-date="${d.key}" aria-labelledby="pk${d.key}">
<h3 class="pk-day-head" id="pk${d.key}"><span class="pk-abbr" aria-hidden="true">${d.weekday.slice(0, 2)}</span><span class="pk-dayname" data-dayname>${d.weekday}</span><span class="pk-date">${d.day}.${d.month}.</span><span class="pk-today">Heute</span></h3>
${d.events.length ? `<ol class="pk-items">${d.events.map(plakatItem).join('')}</ol>` : '<p class="pk-none">Frei</p>'}
</section>`).join('\n')}
</section>`).join('\n')}
</div>
</div>
<section class="pk-exams" aria-labelledby="pk-exams-title">
<h2 class="pk-section-title" id="pk-exams-title">Prüfungen</h2>
${v.exams.length ? `<ol class="pk-exam-list">${v.exams.map((e) => { const s = partsOf(e.start); return `<li class="pk-exam" data-exam data-start="${e.start}" data-end="${e.end}">
<p class="pk-count" data-countdown></p>
<h3 class="pk-exam-name">${title(e.name)}</h3>
<p class="pk-exam-meta">${weekdayOf(s)}, ${longDate(s)} · ${spanText(e.start, e.end)}${e.room ? ` · ${esc(e.room)}` : ''}</p>
</li>`; }).join('')}</ol>` : '<p class="pk-none">Keine Prüfungen in diesem Block.</p>'}
</section>` : emptyCourse}
${mensaSlot}
</div>
</div>`;
}

// =====================================================================
// Tageslicht: a sundial. The day's lectures as arcs on the sun's path from
// 6 to 22, the sun where the time is now (layouts.js moves it), the next
// lecture in the middle. Below, every day as a band of sky from dawn to
// night with its lectures where they fall.
// =====================================================================

const LIGHT_FROM = 6, LIGHT_TO = 22, LIGHT_SPAN = LIGHT_TO - LIGHT_FROM;
// the hour of day on the dial, 0 to 16, clamped
const lightHour = (t, from, to) => Math.min(LIGHT_SPAN, Math.max(0, (t <= from ? 0 : t >= to ? 24 : ((p) => p.hour + p.minute / 60)(partsOf(t))) - LIGHT_FROM));
const ARC = 'M 20 200 A 180 180 0 0 1 380 200';

function lichtDial(heroDay, events, now) {
  if (!heroDay) return '';
  const { from, to } = heroDay;
  const segs = events.map((e) => {
    const a = lightHour(Math.max(e.start, from), from, to), b = lightHour(Math.min(e.end, to), from, to);
    return b > a ? `<path class="li-seg" d="${ARC}" pathLength="${LIGHT_SPAN}" stroke-dasharray="${(b - a).toFixed(3)} ${LIGHT_SPAN}" stroke-dashoffset="${(-a).toFixed(3)}" style="--c: var(--${/^m\d$/.test(e.module) ? e.module : 'm-misc'})"/>` : '';
  }).join('');
  const ticks = [6, 10, 14, 18, 22].map((h) => {
    const t = (h - LIGHT_FROM) / LIGHT_SPAN, x = 200 - 196 * Math.cos(Math.PI * t), y = 200 - 196 * Math.sin(Math.PI * t);
    return `<text class="li-hour" x="${x.toFixed(1)}" y="${(y + (t === 0 || t === 1 ? 16 : -6)).toFixed(1)}">${h}</text>`;
  }).join('');
  return `<svg class="li-arc" viewBox="0 0 400 222" data-dial="${heroDay.key}" aria-hidden="true">
<line class="li-horizon" x1="0" y1="200" x2="400" y2="200"/>
<path class="li-track" d="${ARC}"/>
${segs}
${ticks}
<circle class="li-sun" data-sun cx="20" cy="200" r="10" hidden/>
</svg>`;
}

function lichtHTML(events, { course, full = '', now = Date.now() } = {}) {
  const v = viewData(events, now);
  const next = v.block.find((e) => e.end > now);
  // the day on the dial: the one of the next (or running) lecture
  const heroKey = next ? keyOf(partsOf(next.start)) : null;
  let heroDay = null;
  for (const w of v.weeks) for (const d of w.days) if (d.key === heroKey) heroDay = d;
  const heroFrom = heroDay && berlin(heroDay.year, heroDay.month, heroDay.day);
  const heroTo = heroDay && berlin(heroDay.year, heroDay.month, heroDay.day + 1);
  const today = keyOf(partsOf(now)), tomorrow = keyOf(partsOf(now + 864e5));
  const heroName = !heroDay ? '' : heroKey === today ? 'Heute' : heroKey === tomorrow ? 'Morgen' : `${heroDay.weekday}, ${longDate(heroDay)}`;
  const pos = (e, d) => {
    const from = berlin(d.year, d.month, d.day), to = berlin(d.year, d.month, d.day + 1);
    const a = lightHour(Math.max(e.start, from), from, to), b = lightHour(Math.min(e.end, to), from, to);
    return `--a: ${(a / LIGHT_SPAN * 100).toFixed(2)}%; --b: ${(Math.max(b, a + 0.25) / LIGHT_SPAN * 100).toFixed(2)}%; --lane: ${d.layout.get(e)?.lane ?? 0}`;
  };
  const scale = [6, 9, 12, 15, 18, 21].map((h) => `<span style="--x: ${((h - LIGHT_FROM) / LIGHT_SPAN * 100).toFixed(2)}%">${h}</span>`).join('');

  return `<div class="view v-licht">
<header class="li-head wrap">
<p class="li-greet" data-greeting></p>
<h1 class="li-title" id="page-title">${esc(course)}</h1>
${full ? `<p class="li-full">${esc(full)}</p>` : ''}
${v.range ? `<p class="li-range">Theoriephase ${esc(v.range)}${v.room ? ` · fast alles in ${esc(v.room)}` : ''}</p>` : ''}
</header>
<div class="wrap">
${next ? `<section class="li-dial" aria-labelledby="li-dial-day">
${lichtDial(heroDay && { ...heroDay, from: heroFrom, to: heroTo }, heroDay ? heroDay.events : [], now)}
<div class="li-now" data-now aria-live="polite">
<p class="li-dial-day" id="li-dial-day">${esc(heroName)}</p>
<p class="li-now-label" data-now-label>Als Nächstes</p>
<h2 class="li-now-title" data-now-title>${title(next.name)}</h2>
<p class="li-now-meta" data-now-meta></p>
<p class="li-now-rel" data-now-rel></p>
<div class="li-now-bar" data-now-bar hidden><i data-progress></i></div>
</div>
</section>` : ''}
<p class="li-link">${matchLink(course, 'Freistunden mit einem anderen Kurs finden')}</p>
${v.weeks.length ? `<nav class="li-weeks" data-tabs-scroll aria-label="Wochen"><div class="li-tablist" role="tablist" aria-label="Woche wählen">
${v.weeks.map((w) => `<a class="li-tab" ${tabAttrs(w, now)}>KW ${w.kw}<small>${w.range}</small></a>`).join('')}
</div></nav>
${v.modules.length ? `<div class="li-chips" role="group" aria-label="Nach Modul filtern"><button class="li-chip" type="button" data-filter="all" aria-pressed="true">Alle</button>${v.modules.map(([id, m]) => `<button class="li-chip" type="button" data-filter="${id}" aria-pressed="false" style="--c: var(--${/^m\d$/.test(id) ? id : 'm-misc'})"><i aria-hidden="true"></i>${esc(m.name)}</button>`).join('')}</div>` : ''}
<div class="li-weekpanels">
${v.weeks.map((w) => `<section class="li-week" ${panelAttrs(w)} style="--lo: ${LIGHT_FROM}; --hi: ${LIGHT_TO}">
<h2 class="li-week-title">${w.title}</h2>
<div class="li-scale" aria-hidden="true">${scale}</div>
${w.days.map((d) => { const lanes = Math.max(1, ...[...d.layout.values()].map((p) => p.lanes)); return `<section class="li-day" data-date="${d.key}" aria-labelledby="li${d.key}">
<h3 class="li-day-head" id="li${d.key}"><span data-dayname>${d.weekday}</span> <span class="li-date">${dayLabel(d)}</span></h3>
<div class="li-band" style="--lanes: ${lanes}">${d.events.length ? d.events.map((e) => { const [from, to] = spanParts(e.start, e.end); return `<article class="li-pill" ${evAttrs(e)} style="${pos(e, d)}; --c: var(--${/^m\d$/.test(e.module) ? e.module : 'm-misc'})">
<p class="li-time" data-time>${esc(from)}${to ? ` – ${esc(to)}` : ''}</p>
<h4 class="li-pill-title" data-title>${title(e.name)}</h4>
<p class="li-meta" data-meta>${esc(e.room || hours(e.hours))}</p>
<p class="li-status" data-status></p>
<span class="li-notes" data-note-slot></span>
<i class="li-fill" data-progress aria-hidden="true"></i>
</article>`; }).join('') : '<p class="li-none">Ein freier Tag</p>'}</div>
</section>`; }).join('\n')}
</section>`).join('\n')}
</div>
<section class="li-exams" aria-labelledby="li-exams-title">
<h2 class="li-section-title" id="li-exams-title">Am Horizont: Prüfungen</h2>
${v.exams.length ? `<ol class="li-exam-list">${v.exams.map((e) => { const s = partsOf(e.start); return `<li class="li-exam" data-exam data-start="${e.start}" data-end="${e.end}">
<p class="li-count" data-countdown></p>
<h3 class="li-exam-name">${title(e.name)}</h3>
<p class="li-exam-meta">${weekdayOf(s)}, ${longDate(s)} · ${spanText(e.start, e.end)}${e.room ? ` · ${esc(e.room)}` : ''}</p>
</li>`; }).join('')}</ol>` : '<p class="li-none">Keine Prüfungen in diesem Block.</p>'}
</section>` : emptyCourse}
${mensaSlot}
</div>
</div>`;
}
