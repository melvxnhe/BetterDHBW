// Turns Rapla events of one course into the timetable markup, two courses
// into the Freistunden-Matcher, and the mensa's dishes into its card. Used twice: by build.mjs for the page that ships, and
// in the browser when a course is opened. No imports and no Node APIs, so
// the same file runs in both places (the build strips the `export` keywords).
// What only the build needs lives in catalog.js, home.js and page.js.

export const TZ = 'Europe/Berlin';

export const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const MON_SHORT = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sept.', 'Okt.', 'Nov.', 'Dez.'];
const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const COLOURS = 10; // module colours m0–m9 in styles.css; the rest share grey

// ---------- time (everything is shown in Berlin time) ----------

const partsFormat = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const partsOf = (t) => Object.fromEntries(partsFormat.formatToParts(t).filter((p) => p.type !== 'literal').map((p) => [p.type, +p.value]));

// UTC ms for a wall-clock time in Berlin
export function berlin(y, m, d, h = 0, mi = 0) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const p = partsOf(guess);
  return guess - (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - guess);
}

// Calendar days ({ year, month, day }) are counted as UTC dates, where every day has 24 hours.
const utc = (p) => new Date(Date.UTC(p.year, p.month - 1, p.day));
const dayOf = (date) => ({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
const addDays = (date, n) => new Date(+date + n * 864e5);
const weekdayIndex = (date) => (date.getUTCDay() + 6) % 7; // Monday is 0
export const mondayOf = (p) => addDays(utc(p), -weekdayIndex(utc(p)));

export const keyOf = (p) => `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
export const hm = (p) => `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
// When something runs, as [from, to]: ["08:45", "13:15"]. Rapla stores
// all-day entries as 00:00 to 00:00, which reads as nothing: ["ganztägig"].
// Entries over several days name the day they end: ["08:00", "Fr 13.11., 17:00"].
export function spanParts(start, end) {
  const a = partsOf(start), b = partsOf(end);
  const days = Math.round((utc(b) - utc(a)) / 864e5);
  const dayText = (p) => `${DAY_SHORT[weekdayIndex(utc(p))]} ${p.day}.${p.month}.`;
  if (days >= 1 && hm(a) === '00:00' && hm(b) === '00:00') return days === 1 ? ['ganztägig'] : [`ganztägig bis ${dayText(dayOf(addDays(utc(b), -1)))}`];
  return [hm(a), days >= 1 ? `${dayText(b)}, ${hm(b)}` : hm(b)];
}
export const spanText = (start, end) => spanParts(start, end).join(' – ');
const fromTo = (e) => spanText(e.start, e.end);
const weekdayOf = (p) => WEEKDAYS[weekdayIndex(utc(p))];
const longDate = (p) => `${p.day}. ${MONTHS[p.month - 1]}`;
const num = (n) => (Math.round(n * 10) / 10).toLocaleString('de-DE');
const hours = (h) => (h < 1 ? `${Math.round(h * 60)} Min.` : `${num(h)} Std.`);
export const plural = (n, one, many) => `${n.toLocaleString('de-DE')} ${n === 1 ? one : many}`;
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// the ISO week is the one its Thursday falls in; week 1 holds 4 January
const isoWeek = (p) => {
  const thursday = addDays(utc(p), 3 - weekdayIndex(utc(p)));
  const jan4 = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((thursday - jan4) / 864e5 - 3 + weekdayIndex(jan4)) / 7);
};

// Soft hyphens at the joints of long German compounds. CSS `hyphens: auto`
// has no German dictionary in Chrome on Windows, so narrow columns would
// otherwise break "Betriebswirtschaftslehr|e" anywhere.
const JOINTS = /(?<=\p{L}{3})(wirtschaft|informatik|lehre|vertretung|entwicklung|projekt|studium|prüfung|leistung|veranstaltung|engineering|management|tutorien|konzepte|technik|rechnung|wissenschaft|systeme|modellierung|werkzeuge|verordnung|umsetzung|workshop)/giu;
const title = (s) => esc(s).replace(/\p{L}{13,}/gu, (w) => w.replace(JOINTS, '&shy;$1'));

// ---------- events ----------

const EXAM = /^(Klausur|Prüfungsform|Prüfung|Nachklausur|Wiederholungsklausur)\b/;

// The module a session belongs to: its name without "Klausur", "Begleitetes
// Selbststudium", a group suffix or the course code in brackets.
const moduleName = (name) => name
  .replace(/^(Klausur|Prüfungsform|Prüfung|Nachklausur|Wiederholungsklausur|Begleitetes Selbststudium|Selbststudium|Übung|Tutorium|Vorlesung)\s+/i, '')
  .replace(/\s*\((MA-)?[A-Z][A-Z0-9-]*\)\s*$/, '')
  .replace(/\s+(Gruppe|Grp\.?)\s*[A-Z0-9]+$/i, '')
  .replace(/^(Grundlagen der|Grundlegende|Einführung in die)\s+(?=\p{Lu})/u, '')
  .trim();

export function normalize(list) {
  const events = (Array.isArray(list) ? list : [])
    .filter((e) => e && e.startTime && e.endTime && e.name)
    .map((e) => {
      const start = +new Date(e.startTime), end = +new Date(e.endTime);
      const name = String(e.name).trim().replace(/\s*\((MA-)?[A-Z][A-Z0-9-]*\d[A-Z0-9-]*\)\s*$/, '').replace(/\s+/g, ' ');
      const rooms = (e.rooms || []).map((r) => String(r).replace(/ VL-Raum Unterrichtsraum$/, '').trim()).filter(Boolean);
      const online = e.type === 'ONLINE' || rooms.some((r) => /Online/.test(r));
      const exam = name.match(EXAM);
      return {
        id: e.id, name, start, end,
        room: online ? 'Online' : rooms.length ? `Raum ${rooms.join(', ')}` : '',
        exam: exam ? exam[1] : '',
        moduleName: moduleName(name) || name,
        hours: Math.max(0, (end - start) / 36e5),
      };
    })
    .filter((e) => e.end > e.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  // colour modules by how often they occur, so the main ones get distinct hues
  const counts = new Map();
  events.forEach((e) => counts.set(e.moduleName, (counts.get(e.moduleName) || 0) + 1));
  const ranked = [...counts].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).map(([m]) => m);
  events.forEach((e) => { const i = ranked.indexOf(e.moduleName); e.module = i >= 0 && i < COLOURS ? `m${i}` : i >= 0 ? `x${i}` : 'misc'; });
  return events;
}

// Theory phases are separated by gaps of more than three weeks (the practice
// phase). The block shown is the one running now, else the next one, else the
// last one; its past weeks stay in. Earlier and later blocks are only counted.
export function splitBlock(events, now = Date.now()) {
  if (!events.length) return { block: [], earlier: [], later: [] };
  const blocks = [[events[0]]];
  for (let i = 1; i < events.length; i++) {
    if (events[i].start - events[i - 1].end > 21 * 864e5) blocks.push([]);
    blocks.at(-1).push(events[i]);
  }
  let i = blocks.findIndex((b) => b.at(-1).end > now);
  if (i < 0) i = blocks.length - 1;
  return { block: blocks[i], earlier: blocks.slice(0, i).flat(), later: blocks.slice(i + 1).flat() };
}

// Every week from the first to the last entry, gaps included, so a week
// without lectures shows up as one instead of vanishing.
export function toWeeks(block) {
  if (!block.length) return [];
  const byDay = new Map();
  block.forEach((e) => { const k = keyOf(partsOf(e.start)); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(e); });
  const weeks = [];
  const last = mondayOf(partsOf(block.at(-1).start));
  for (let monday = mondayOf(partsOf(block[0].start)); monday <= last; monday = addDays(monday, 7)) {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const p = dayOf(addDays(monday, i));
      const key = keyOf(p);
      const list = byDay.get(key) || [];
      if (i < 5 || list.length) days.push({ ...p, key, weekday: WEEKDAYS[i], events: list }); // a weekend day only when something is on
    }
    const p0 = days[0], p4 = days[4], next = dayOf(addDays(monday, 7));
    const kw = isoWeek(p0);
    weeks.push({
      id: `kw${kw}-${p0.year}`, kw, days,
      start: berlin(p0.year, p0.month, p0.day),
      end: berlin(next.year, next.month, next.day),
      events: days.flatMap((x) => x.events),
      title: p0.month === p4.month ? `${p0.day}.–${p4.day}. ${MONTHS[p4.month - 1]}` : `${p0.day}. ${MON_SHORT[p0.month - 1]} – ${p4.day}. ${MON_SHORT[p4.month - 1]}`,
      range: `${p0.day}.${p0.month}.–${p4.day}.${p4.month}.`,
    });
  }
  return weeks;
}

// ---------- markup ----------

// `heading`: h4 inside a week; the homepage preview has no headings above it and passes p
function sessionHTML(e, heading = 'h4') {
  const [from, to] = spanParts(e.start, e.end);
  const meta = [e.room, hours(e.hours)].filter(Boolean).join(' · ');
  return `<article class="session" data-id="${esc(String(e.id ?? ''))}" data-module="${e.module}" data-start="${e.start}" data-end="${e.end}" data-room="${esc(e.room)}">
${e.exam ? `<span class="session-tag">${esc(e.exam)}</span>` : ''}<p class="session-time"><time datetime="${new Date(e.start).toISOString()}">${from}</time>${to ? ` – <time datetime="${new Date(e.end).toISOString()}">${to}</time>` : ''}</p>
<${heading} class="session-title">${title(e.name)}</${heading}>
<p class="session-meta">${esc(meta)}</p>
<p class="session-status"></p>
<div class="progress" aria-hidden="true"><i></i></div>
</article>`;
}

function weekHTML(w) {
  const h = w.events.reduce((sum, e) => sum + e.hours, 0);
  const exams = w.events.filter((e) => e.exam).length;
  const facts = [`KW ${w.kw}`, w.events.length ? plural(w.events.length, 'Termin', 'Termine') : 'keine Termine'];
  if (w.events.length) facts.push(hours(h));
  if (exams) facts.push(plural(exams, 'Prüfungstermin', 'Prüfungstermine'));
  const days = w.days.map((d) => `<section class="day" data-date="${d.key}" aria-labelledby="d${d.key}">
<h3 class="day-head" id="d${d.key}"><span class="day-name">${d.weekday}</span> <span class="day-date">${d.day}. ${MON_SHORT[d.month - 1]}</span> <span class="today-pill">Heute</span></h3>
<div class="day-items">${d.events.length ? d.events.map((e) => sessionHTML(e)).join('\n') : '<p class="day-empty">Keine Termine</p>'}</div>
</section>`).join('\n');
  return `<section class="week" id="${w.id}" role="tabpanel" aria-labelledby="tab-${w.id}" data-start="${w.start}" data-end="${w.end}">
<header class="week-head"><h2 class="week-title">${w.title}</h2><p class="week-facts">${facts.join(' · ')}</p></header>
<div class="days" style="--cols: ${w.days.length}">
${days}
</div>
</section>`;
}

function examHTML(e) {
  const s = partsOf(e.start);
  return `<li class="exam" data-start="${e.start}" data-end="${e.end}">
<p class="exam-date" aria-hidden="true"><span class="exam-day">${s.day}</span><span class="exam-month">${MON_SHORT[s.month - 1]}</span></p>
<div class="exam-body">
<h3 class="exam-name">${title(e.name)}</h3>
<p class="exam-meta">${weekdayOf(s)}, ${longDate(s)} · ${fromTo(e)}${e.room ? ' · ' + esc(e.room) : ''}</p>
<p class="exam-countdown"></p>
</div>
</li>`;
}

function rangeText(first, last) {
  const a = partsOf(first.start), b = partsOf(last.start);
  const nb = (t) => `<span>${t}</span>`;
  if (a.year === b.year && a.month === b.month && a.day === b.day) return nb(`${longDate(a)} ${a.year}`);
  if (a.year === b.year && a.month === b.month) return `${nb(`${a.day}.–${b.day}. ${MONTHS[b.month - 1]}`)} ${b.year}`;
  return `${nb(`${longDate(a)}${a.year !== b.year ? ' ' + a.year : ''}`)} – ${nb(`${longDate(b)} ${b.year}`)}`;
}

// What the now card says before the script updates it every minute.
function nowCardHTML(block, now, heading = 'h2') {
  const next = block.find((e) => e.end > now);
  const day = next && partsOf(next.start);
  const meta = next ? [`${weekdayOf(day)}, ${longDate(day)}`, fromTo(next), next.room].filter(Boolean).join(' · ') : '';
  return `<section class="now" aria-label="Aktueller Termin" aria-live="polite">
<p class="now-label"><span class="now-pulse" aria-hidden="true"></span><span class="now-label-text">${next ? 'Als Nächstes' : 'Keine Termine'}</span></p>
<${heading} class="now-title">${next ? title(next.name) : 'In Rapla sind für diesen Kurs keine kommenden Termine eingetragen.'}</${heading}>
<p class="now-meta">${esc(meta)}</p>
<p class="now-rel"></p>
<div class="progress" hidden><i></i></div>
</section>`;
}

// " Fast alles in Raum 258B." when at least 60 % of the lectures share a room
function mainRoomText(lectures) {
  const counts = {};
  lectures.forEach((e) => { if (e.room) counts[e.room] = (counts[e.room] || 0) + 1; });
  const [room, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || [];
  return room && lectures.length >= 4 && n >= lectures.length * 0.6 ? ` Fast alles in ${esc(room)}.` : '';
}

// One filter chip per module, the most frequent first; one-off events ("misc") get none.
function chipsHTML(block) {
  const modules = new Map();
  block.forEach((e) => { if (!modules.has(e.module)) modules.set(e.module, { name: e.moduleName, n: 0 }); modules.get(e.module).n++; });
  return [...modules].filter(([id]) => id !== 'misc').sort((a, b) => b[1].n - a[1].n).map(([id, m]) =>
    `<button class="chip" type="button" data-filter="${id}" aria-pressed="false" title="${esc(m.name)}"><span class="dot" aria-hidden="true"></span><span class="chip-label">${esc(m.name)}</span> <span class="count">${m.n}</span></button>`).join('');
}

// The week tabs. timetable.js finds them by their roles and ids, shows one
// week at a time and slides a clipped copy (.tabs-active) under the chosen tab.
function tabsHTML(weeks, now) {
  const tab = (w, copy) => copy
    ? `<span class="tab"><span class="tab-kw">KW ${w.kw}</span><span class="tab-range">${w.range}</span></span>`
    : `<a class="tab${w.end <= now ? ' is-past' : ''}" role="tab" id="tab-${w.id}" href="#${w.id}" aria-controls="${w.id}" aria-selected="false"><span class="tab-kw">KW ${w.kw}</span><span class="tab-range">${w.range}</span></a>`;
  return `<nav class="scroller tabs-scroll" aria-label="Wochen">
<div class="tabs-track">
<div class="tabs" role="tablist" aria-label="Woche wählen">${weeks.map((w) => tab(w)).join('')}</div>
<div class="tabs tabs-active" aria-hidden="true">${weeks.map((w) => tab(w, true)).join('')}</div>
</div>
</nav>`;
}

// The <main> content for one course. `now` only decides what the now card
// says before the script updates it.
export function mainHTML(events, { course, full = '', now = Date.now() } = {}) {
  const { block } = splitBlock(events, now);
  const weeks = toWeeks(block);
  const exams = block.filter((e) => e.exam);
  const lectures = block.filter((e) => !e.exam);

  const chips = chipsHTML(block);

  const subtitle = block.length
    ? `Stundenplan der Theoriephase an der DHBW Mannheim, <b>${rangeText(block[0], block.at(-1))}</b>.${mainRoomText(lectures)}`
    : 'Stundenplan an der DHBW Mannheim.';

  return `<div class="wrap">
<section class="intro" aria-labelledby="page-title">
<div>
<h1 class="title" id="page-title">${esc(course)}</h1>
${full ? `<p class="title-full">${esc(full)}</p>` : ''}
<p class="subtitle">${subtitle}</p>
<p class="intro-link"><a href="?frei=${encodeURIComponent(course)}" data-match-link="${esc(course)}">Freistunden mit einem anderen Kurs finden</a></p>
</div>
${block.length ? nowCardHTML(block, now) : ''}
</section>

${weeks.length ? `<div class="controls">
${tabsHTML(weeks, now)}
${chips ? `<div class="scroller filters-scroll"><div class="filters" role="group" aria-label="Nach Modul filtern"><button class="chip" type="button" data-filter="all" aria-pressed="true">Alle Module</button>${chips}</div></div>` : ''}
</div>

<div class="weeks">
${weeks.map(weekHTML).join('\n')}
</div>

<section class="exams" aria-labelledby="exams-title">
<h2 class="section-title" id="exams-title">Prüfungen</h2>
${exams.length ? `<ol class="exam-list">
${exams.map(examHTML).join('\n')}
</ol>` : '<p class="empty-state">In Rapla sind für diesen Block keine Prüfungen eingetragen.</p>'}
</section>` : `<p class="empty-state empty-course">In Rapla sind für diesen Kurs keine Termine eingetragen. Vielleicht ist er schon fertig, oder noch nicht im Plan.</p>`}
<section class="mensa" data-mensa aria-labelledby="mensa-title" hidden></section>
</div>`;
}

// ---------- the Freistunden-Matcher: when two courses are both free ----------

const MIN_GAP = 30 * 60000; // anything shorter is the break between two lectures, not free time

// "1 Std. 15 Min.", "45 Min."
function lengthText(ms) {
  const min = Math.round(ms / 6e4), h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} Std.${m ? ` ${m} Min.` : ''}` : `${m} Min.`;
}

// Time spans [from, to] sorted, and those that touch or overlap joined into one.
function mergeSpans(spans) {
  const out = [];
  for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) {
    const last = out.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

// When a course is busy within [from, to): its events cut to that window and joined.
const busyIn = (events, from, to) => mergeSpans(events.filter((e) => e.start < to && e.end > from).map((e) => [Math.max(e.start, from), Math.min(e.end, to)]));

// One day [from, to) of two courses:
// - busyA, busyB: when each has something on
// - gaps: when both are free for at least 30 minutes between the first start
//   and the last end of the day, while one of them still has lectures (the "Freistunden")
// - after: from when both are done, if that is before the day ends
// - free: neither has anything that day
export function matchDay(a, b, from, to) {
  const busyA = busyIn(a, from, to), busyB = busyIn(b, from, to);
  const both = mergeSpans([...busyA, ...busyB]);
  if (!both.length) return { busyA, busyB, gaps: [], after: null, free: true };
  const gaps = [];
  for (let i = 1; i < both.length; i++) {
    if (both[i][0] - both[i - 1][1] >= MIN_GAP) gaps.push([both[i - 1][1], both[i][0]]);
  }
  const end = both.at(-1)[1];
  return { busyA, busyB, gaps, after: end < to ? end : null, free: false };
}

// The weeks to compare: from the first to the last week of the block each
// course shows (its running theory phase, else the next one), every day with
// matchDay() of the two. The weekend only when one of them has something on.
export function matchWeeks(a, b, now = Date.now()) {
  const blockA = splitBlock(a, now).block, blockB = splitBlock(b, now).block;
  return toWeeks([...blockA, ...blockB].sort((x, y) => x.start - y.start)).map((w) => ({
    ...w,
    days: w.days.map((d) => {
      const next = dayOf(addDays(utc(d), 1));
      const from = berlin(d.year, d.month, d.day), to = berlin(next.year, next.month, next.day);
      return { ...d, from, to, ...matchDay(blockA, blockB, from, to) };
    }),
  }));
}

// The next time both are free, from now on: a Freistunde, or the end of a
// day with lectures. null when there is none left in the weeks compared.
export function matchNext(weeks, now = Date.now()) {
  for (const w of weeks) {
    for (const d of w.days) {
      const windows = [...d.gaps, ...(d.after ? [[d.after, d.to]] : [])];
      const found = windows.find(([, to]) => to > now);
      if (found) return { day: d, from: found[0], to: found[1], open: found[1] === d.to };
    }
  }
  return null;
}

// "Heute", "Morgen", "Mittwoch, 11. November"
function dayName(d, now) {
  const today = partsOf(now), tomorrow = dayOf(addDays(utc(today), 1));
  if (d.key === keyOf(today)) return 'Heute';
  if (d.key === keyOf(tomorrow)) return 'Morgen';
  return `${d.weekday}, ${longDate(d)}`;
}

// The card at the top: the next time both are free. Drawn again every minute.
export function matchNextHTML(weeks, now = Date.now()) {
  const next = matchNext(weeks, now);
  if (!next) {
    return `<section class="match-next" data-match-next aria-live="polite"><p class="match-next-label">Als Nächstes gemeinsam frei</p>
<p class="match-next-title">In den Wochen hier gibt es keine gemeinsame Freistunde mehr.</p></section>`;
  }
  const running = next.from <= now;
  const when = next.open ? `ab ${hm(partsOf(next.from))}` : `${hm(partsOf(next.from))} – ${hm(partsOf(next.to))}`;
  const title = running ? (next.open ? 'Jetzt, beide haben Schluss' : `Jetzt, bis ${hm(partsOf(next.to))}`) : `${dayName(next.day, now)}, ${when}`;
  const meta = next.open ? 'Beide sind für heute fertig.' : `${lengthText(next.to - Math.max(next.from, now))} ${running ? 'noch ' : ''}zwischen den Vorlesungen`;
  return `<section class="match-next${running ? ' is-live' : ''}" data-match-next aria-live="polite">
<p class="match-next-label">${running ? 'Gerade gemeinsam frei' : 'Als Nächstes gemeinsam frei'}</p>
<p class="match-next-title">${title}</p>
<p class="match-next-meta">${meta}</p>
</section>`;
}

// A bar of time spans; --s and --e are hours of the day, placed between the
// week's --lo and --hi by styles.css.
function barsHTML(spans, at, lo, hi) {
  return spans.map(([a, b]) => [Math.max(lo, at(a)), Math.min(hi, at(b))]).filter(([s, e]) => e > s)
    .map(([s, e]) => `<i style="--s: ${+s.toFixed(3)}; --e: ${+e.toFixed(3)}"></i>`).join('');
}

// The free time of both within the scale [lo, hi], for the bottom bar.
function freeSpans(d, at, lo, hi) {
  const busy = mergeSpans([...d.busyA, ...d.busyB].map(([a, b]) => [at(a), at(b)]));
  const out = [];
  let from = lo;
  for (const [s, e] of busy) { if (s - from >= 0.5) out.push([from, Math.min(s, hi)]); from = Math.max(from, e); }
  if (hi - from >= 0.5) out.push([from, hi]);
  return out.filter(([s, e]) => e > s);
}

function matchDayHTML(d, [nameA, nameB], lo, hi) {
  // the hour of the day of a time, 0 to 24 (as on the clock, so also on the days the clocks change)
  const at = (t) => (t >= d.to ? 24 : t <= d.from ? 0 : ((p) => p.hour + p.minute / 60)(partsOf(t)));
  const times = (spans) => spans.map(([a, b]) => spanText(a, b)).join(', ') || 'nichts';
  const list = [
    ...d.gaps.map(([a, b]) => `<li><b>${hm(partsOf(a))} – ${hm(partsOf(b))}</b> <span>${lengthText(b - a)}</span></li>`),
    ...(d.after ? [`<li><b>ab ${hm(partsOf(d.after))}</b> <span>beide fertig</span></li>`] : []),
  ];
  const text = d.free ? '<p class="match-none">Beide haben nichts eingetragen.</p>'
    : list.length ? `<ul class="match-gaps">${list.join('')}</ul>` : '<p class="match-none">Keine gemeinsame Freistunde.</p>';
  return `<section class="day match-day${d.free ? ' is-free' : ''}" data-date="${d.key}" aria-labelledby="f${d.key}">
<h3 class="day-head" id="f${d.key}"><span class="day-name">${d.weekday}</span> <span class="day-date">${d.day}. ${MON_SHORT[d.month - 1]}</span> <span class="today-pill">Heute</span></h3>
<div class="match-bars" aria-hidden="true">
<div class="match-bar is-a">${barsHTML(d.busyA, at, lo, hi)}</div>
<div class="match-bar is-b">${barsHTML(d.busyB, at, lo, hi)}</div>
<div class="match-bar is-free">${barsHTML(freeSpans(d, at, lo, hi), (h) => h, lo, hi)}</div>
</div>
<p class="visually-hidden">${esc(nameA)}: ${times(d.busyA)}. ${esc(nameB)}: ${times(d.busyB)}.</p>
${text}
</section>`;
}

// The hours a week's bars show: 8 to 18, more when something starts earlier
// or ends later. All-day entries don't stretch it; they just fill the bar.
function weekScale(w) {
  let lo = 8, hi = 18;
  for (const d of w.days) {
    for (const [a, b] of [...d.busyA, ...d.busyB]) {
      if (b - a >= 12 * 36e5) continue;
      const s = partsOf(a), e = b >= d.to ? null : partsOf(b);
      lo = Math.min(lo, s.hour);
      hi = Math.max(hi, e ? e.hour + (e.minute ? 1 : 0) : 24);
    }
  }
  return [lo, Math.min(24, hi)];
}

function matchWeekHTML(w, names) {
  const [lo, hi] = weekScale(w);
  const weekdays = w.days.filter((d) => !/^S/.test(d.weekday));
  const gapTime = weekdays.reduce((sum, d) => sum + d.gaps.reduce((s, [a, b]) => s + b - a, 0), 0);
  const gapDays = weekdays.filter((d) => d.gaps.length).length;
  const facts = [`KW ${w.kw}`, gapTime ? `${lengthText(gapTime)} gemeinsame Freistunden an ${plural(gapDays, 'Tag', 'Tagen')}` : 'keine gemeinsamen Freistunden'];
  const ticks = [];
  for (let h = Math.ceil(lo / 2) * 2; h <= hi; h += 2) ticks.push(`<span style="--s: ${h}">${h}</span>`);
  return `<section class="week match-week" id="${w.id}" role="tabpanel" aria-labelledby="tab-${w.id}" data-start="${w.start}" data-end="${w.end}" style="--lo: ${lo}; --hi: ${hi}">
<header class="week-head"><h2 class="week-title">${w.title}</h2><p class="week-facts">${facts.join(' · ')}</p></header>
<div class="match-days">
<div class="match-axis" aria-hidden="true">${ticks.join('')}</div>
${w.days.map((d) => matchDayHTML(d, names, lo, hi)).join('\n')}
</div>
</section>`;
}

// What the matcher shows for two courses: who is which colour, the next
// time both are free, and a week at a time with each day's bars and Freistunden.
export function matchHTML(a, b, { names, now = Date.now() }) {
  const weeks = matchWeeks(a, b, now);
  const legend = `<p class="match-legend"><span class="is-a">${esc(names[0])}</span><span class="is-b">${esc(names[1])}</span><span class="is-free">beide frei</span></p>`;
  if (!weeks.length) return `<p class="empty-state">In Rapla sind für beide Kurse gerade keine Termine eingetragen.</p>`;
  const empty = [a, b].map((list, i) => (splitBlock(list, now).block.length ? '' : names[i])).filter(Boolean);
  return `${legend}
${empty.length ? `<p class="match-note">Für ${esc(empty[0])} sind gerade keine Termine eingetragen (Praxisphase?). Der Vergleich zeigt nur den anderen Kurs.</p>` : ''}
${matchNextHTML(weeks, now)}
<div class="controls">
${tabsHTML(weeks, now)}
</div>
<div class="weeks">
${weeks.map((w) => matchWeekHTML(w, names)).join('\n')}
</div>`;
}

// What follows the block shown: up to three kinds of events by name and
// date ("Klausur X am 3.2.2027"), more than that as a count.
function laterHTML(later) {
  if (!later.length) return '';
  const names = [...new Set(later.map((e) => e.name))];
  if (names.length > 3) {
    const s = partsOf(later[0].start);
    return `${plural(later.length, 'weiterer Termin', 'weitere Termine')} ab ${longDate(s)} ${s.year}, alle in der Kalenderdatei`;
  }
  return names.map((n) => {
    const dates = later.filter((e) => e.name === n).map((e) => { const s = partsOf(e.start); return `${s.day}.${s.month}.${s.year}`; });
    return `${esc(n.replace(/ - /, ': '))} am ${dates.join(', ')}`;
  }).join('; ');
}

export function footerHTML(events, { course, fetchedAt = Date.now() } = {}) {
  const { earlier, later } = splitBlock(events, fetchedAt);
  const p = partsOf(fetchedAt);
  const laterText = laterHTML(later);
  return `<div class="wrap">
<p>Daten aus Rapla (DHBW Mannheim), abgerufen über <a href="https://dhbw.app">dhbw.app</a>. Stand: ${p.day}. ${MONTHS[p.month - 1]} ${p.year}, ${hm(p)} Uhr.</p>
${earlier.length ? `<p>Vor diesem Block: ${plural(earlier.length, 'Termin', 'Termine')} aus früheren Theoriephasen, alle in der Kalenderdatei.</p>` : ''}
${laterText ? `<p>Nach diesem Block: ${laterText}.</p>` : ''}
<p><a href="#" data-ics download="${esc(course.toLowerCase())}.ics">Alle Termine von ${esc(course)} als Kalenderdatei (.ics)</a></p>
</div>`;
}

export function icsFor(course, events, now = Date.now()) {
  const stamp = (t) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const escI = (s) => s.replace(/\\/g, '\\\\').replace(/[,;]/g, (m) => '\\' + m);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${course}//Stundenplan//DE`, 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${course} Stundenplan`, 'X-WR-TIMEZONE:Europe/Berlin'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:rapla-${String(e.id).replace(/[^\w-]/g, '')}-${course}@dhbw-stundenplan`, `DTSTAMP:${stamp(now)}`, `DTSTART:${stamp(e.start)}`, `DTEND:${stamp(e.end)}`,
      `SUMMARY:${escI(e.name)}`, `LOCATION:${escI(e.room === 'Online' ? 'Online' : ['DHBW Mannheim', e.room].filter(Boolean).join(', '))}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

// ---------- the mensa: Mensaria Metropol and greenes², from /api/mensa ----------

const DAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const euro = (n) => (typeof n === 'number' && n > 0 ? n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }) : '');
const STW = 'https://www.stw-ma.de/essen-trinken/speiseplaene/mensaria-metropol-greenes/';

// Today and the days ahead; the card opens on the first of them. Once the
// counter has closed ("11:30 – 14:00 Uhr") today is marked `over`.
export function mensaDays(mensa, now = Date.now()) {
  const p = partsOf(now), today = keyOf(p), clock = hm(p);
  const close = (String(mensa?.hours || '').match(/(\d{1,2}):(\d{2})\D*$/) || []).slice(1).map((x) => x.padStart(2, '0')).join(':');
  return (mensa?.days || [])
    .map((d) => ({ ...d, key: keyOf(partsOf(+new Date(d.date))) }))
    .filter((d) => d.key >= today)
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(0, 5)
    .map((d) => ({ ...d, over: d.key === today && !!close && clock >= close }));
}

// "Power bowl: gebackene Kartoffeln, …" → name and what's in it;
// "Lasagne Bolognese, Rucola und …" → the dish, then the rest.
function dishHTML(d) {
  const text = d.name.replace(/\s+/g, ' ').trim();
  const at = text.indexOf(': ') > 0 && text.indexOf(': ') < 40 ? text.indexOf(': ') : text.indexOf(', ');
  const head = at > 0 ? text.slice(0, at) : text, rest = at > 0 ? text.slice(at + 2) : '';
  return `<li class="dish"><p class="dish-name"><b>${esc(head.charAt(0).toUpperCase() + head.slice(1))}</b>${rest ? ` <span>${esc(rest)}</span>` : ''}</p>${euro(d.student) ? `<p class="dish-price">${euro(d.student)}</p>` : ''}</li>`;
}

export function mensaHTML(mensa, { now = Date.now(), pick = null } = {}) {
  const days = mensaDays(mensa, now);
  const day = days.find((d) => d.key === pick) || days[0];
  const today = keyOf(partsOf(now)), tomorrow = keyOf(partsOf(now + 864e5));
  const label = (d) => {
    if (d.key === today) return 'Heute';
    if (d.key === tomorrow) return 'Morgen';
    const [year, month, day] = d.key.split('-').map(Number);
    return `${DAY_SHORT[weekdayIndex(utc({ year, month, day }))]} ${day}.`;
  };
  const open = mensa?.hours ? `${esc(mensa.hours.replace(/\s*Uhr\s*$/, ''))} Uhr` : ''; // "11:30 – 14:00 Uhr"
  const url = /^https:\/\/www\.stw-ma\.de\//.test(mensa?.url || '') ? mensa.url : STW;
  const col = (title, list, extra = '') => `<div class="mensa-col"><h3 class="mensa-col-title">${title}</h3>
${list.length ? `<ul class="dishes">${list.map(dishHTML).join('')}</ul>` : '<p class="mensa-none">Nichts eingetragen.</p>'}${extra}</div>`;
  const desserts = day?.desserts?.length ? `<p class="mensa-desserts"><b>Dessert</b> ${esc(day.desserts.map((d) => d.name.trim()).join(' · '))}</p>` : '';
  return `<header class="mensa-head">
<div><h2 class="section-title" id="mensa-title">Mensa</h2>
<p class="mensa-lead">${esc(mensa?.name || 'Mensaria Metropol')}${open ? ` · ${open}` : ''} · Preise für Studierende</p></div>
${days.length > 1 ? `<div class="mensa-days" role="group" aria-label="Tag wählen">${days.map((d) => `<button class="chip" type="button" data-mensa-day="${d.key}" aria-pressed="${d === day}">${label(d)}</button>`).join('')}</div>` : ''}
</header>
${!day ? '<p class="empty-state">Für die nächsten Tage ist noch kein Speiseplan eingetragen.</p>'
    : day.closed ? `<p class="empty-state">${label(day)} ist die Mensa geschlossen.</p>`
      : `${day.over ? `<p class="mensa-note">Die Ausgabe hat heute schon geschlossen${open ? ` (${open})` : ''}.</p>` : ''}<div class="mensa-grid">
${col('Mensaria Metropol', day.main, desserts)}
${col('greenes²', day.greenes)}
</div>`}
<p class="mensa-more"><a href="${esc(url)}" rel="noopener">Ganzer Speiseplan beim Studierendenwerk</a></p>`;
}

// ---------- the homepage preview ----------

// A real piece of the timetable for the hero: one course's now card and its
// next day with lectures. The page script keeps it live like the real plan.
// The entry whose day the preview shows: the next one that starts today or
// later. Something that began days ago and still runs (a project week) would
// otherwise pull the preview back to the day it started.
export function previewEvent(block, now) {
  const today = keyOf(partsOf(now));
  return block.find((e) => e.end > now && keyOf(partsOf(e.start)) >= today) || block.find((e) => e.end > now) || block.at(-1);
}

export function previewHTML(course, events, now) {
  const { block } = splitBlock(events, now);
  if (!block.length) return '';
  const upcoming = previewEvent(block, now);
  const key = keyOf(partsOf(upcoming.start));
  const day = block.filter((e) => keyOf(partsOf(e.start)) === key);
  const p = partsOf(upcoming.start);
  return `<div class="preview" aria-labelledby="preview-title">
<p class="preview-head" id="preview-title"><b>${esc(course)}</b><span>so sieht ein Plan aus</span></p>
${nowCardHTML(block, now, 'h3')}
<section class="day preview-day" data-date="${key}" aria-labelledby="pv${key}">
<h3 class="day-head" id="pv${key}"><span class="day-name">${weekdayOf(p)}</span> <span class="day-date">${p.day}. ${MON_SHORT[p.month - 1]}</span> <span class="today-pill">Heute</span></h3>
<div class="day-items">${day.map((e) => sessionHTML(e, 'p')).join('\n')}</div>
</section>
<p class="preview-open"><a href="?kurs=${encodeURIComponent(course)}" data-course-link="${esc(course)}">Ganzen Plan von ${esc(course)} öffnen</a></p>
</div>`;
}
