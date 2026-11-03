// Turns Rapla events of one course into the timetable markup. Used twice:
// by build.mjs for the page that ships, and in the browser when someone
// searches for another course. No imports and no Node APIs, so the same
// file runs in both places (the build strips the `export` keywords).

export const TZ = 'Europe/Berlin';

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
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

const keyOf = (p) => `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
export const hm = (p) => `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
const weekdayOf = (p) => WEEKDAYS[(new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() + 6) % 7];
const longDate = (p) => `${p.day}. ${MONTHS[p.month - 1]}`;
const num = (n) => (Math.round(n * 10) / 10).toLocaleString('de-DE');
const hours = (h) => (h < 1 ? `${Math.round(h * 60)} Min.` : `${num(h)} Std.`);
const plural = (n, one, many) => `${n.toLocaleString('de-DE')} ${n === 1 ? one : many}`;
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const isoWeek = (y, m, d) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7));
  const jan4 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t - jan4) / 864e5 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
};

// Soft hyphens at the joints of long German compounds. CSS `hyphens: auto`
// has no German dictionary in Chrome on Windows, so narrow columns would
// otherwise break "Betriebswirtschaftslehr|e" anywhere.
const JOINTS = /(?<=\p{L}{3})(wirtschaft|informatik|lehre|vertretung|entwicklung|projekt|studium|prüfung|leistung|veranstaltung|engineering|management|tutorien|konzepte|technik|rechnung|wissenschaft|systeme)/giu;
const title = (s) => esc(s).replace(/\p{L}{13,}/gu, (w) => w.replace(JOINTS, '&shy;$1'));

// ---------- courses ----------

const FACULTY = { W: 'Wirtschaft', T: 'Technik', G: 'Gesundheit', S: 'Sozialwesen', I: 'International' };

// Studienrichtungen behind the letters after the year, as the DHBW Mannheim
// names them. Only codes with a known meaning; the rest show the degree alone.
const TRACKS = {
  WWI: { SE: 'Software Engineering', SC: 'Sales & Consulting', AM: 'Application Management', DS: 'Data Science',
    IMBIT: 'International Management for Business and Information Technology', EG: 'E-Government', DH: 'Digital Health', EH: 'E-Health' },
  TINF: { CS: 'Cyber Security', IT: 'Informationstechnik', AI: 'Angewandte Informatik' },
};

// "WWI26SEA" → "Software Engineering", or '' for codes without a known track
function trackOf(name) {
  const [, code = '', , rest = ''] = name.match(/^([A-Z]+?)(\d{2})(.*)$/) || [];
  const tracks = TRACKS[code] || {};
  const known = rest.split('-').map((part) => {
    const key = Object.keys(tracks).sort((a, b) => b.length - a.length)
      .find((k) => part.startsWith(k) && /^(?:[A-E]|\d)?$/.test(part.slice(k.length)));
    return key && tracks[key];
  }).filter(Boolean);
  return [...new Set(known)].join(' & ');
}

// "WWI26SEA" → "Wirtschaftsinformatik – Software Engineering 26"
function fullName(name, degree, track) {
  if (!degree) return '';
  const year = (name.match(/\d{2}/) || [''])[0];
  return `${degree}${track ? ` – ${track}` : ''}${year ? ` ${year}` : ''}`;
}

// "MA-WWI26SEA" and "MA---WWI26SEA" are the same course in two Rapla
// generations; the list keeps one name with every id, the older id first.
// `parsed` is api.dhbw.app's /courses/MA/parsed: the degree of each course.
export function courseList(ids, parsed = []) {
  const info = new Map(), byCode = new Map();
  for (const c of parsed) {
    if (!c?.degree) continue;
    info.set(String(c.name).replace(/^MA-+/, ''), c);
    byCode.set(c.degree.abbreviation, c); // for courses only listed under their old id
  }
  const infoOf = (name) => info.get(name) || byCode.get((name.match(/^([A-Z]+?)\d{2}/) || [])[1]);
  const byName = new Map();
  for (const id of ids) {
    if (!/^MA-+[A-Z]/.test(id)) continue;
    const name = id.replace(/^MA-+/, '');
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(id);
  }
  return [...byName].map(([name, list]) => {
    const year = name.match(/\d{2}/);
    const meta = [FACULTY[name[0]], year ? `Jahrgang 20${year[0]}` : ''].filter(Boolean).join(' · ');
    const degree = infoOf(name)?.degree?.name?.trim().replace(/\s+-\s+/g, ' – ').replace(/\s+/g, ' ') || '';
    const track = degree ? trackOf(name) : '';
    return { name, meta, degree, track, full: fullName(name, degree, track), ids: list.sort((a, b) => a.length - b.length) };
  }).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

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
  const first = partsOf(block[0].start), last = partsOf(block.at(-1).start);
  const monday = (p) => { const d = new Date(Date.UTC(p.year, p.month - 1, p.day)); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d; };
  const byDay = new Map();
  block.forEach((e) => { const k = keyOf(partsOf(e.start)); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(e); });
  const weeks = [];
  for (let d = monday(first); d <= monday(last); d.setUTCDate(d.getUTCDate() + 7)) {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const x = new Date(d); x.setUTCDate(x.getUTCDate() + i);
      const p = { year: x.getUTCFullYear(), month: x.getUTCMonth() + 1, day: x.getUTCDate() };
      const key = keyOf(p);
      const list = byDay.get(key) || [];
      if (i < 5 || list.length) days.push({ ...p, key, weekday: WEEKDAYS[i], events: list });
    }
    const p0 = days[0], p4 = days[4];
    const endDay = new Date(d); endDay.setUTCDate(endDay.getUTCDate() + 7);
    const kw = isoWeek(p0.year, p0.month, p0.day);
    weeks.push({
      id: `kw${kw}-${p0.year}`, kw, days,
      start: berlin(p0.year, p0.month, p0.day),
      end: berlin(endDay.getUTCFullYear(), endDay.getUTCMonth() + 1, endDay.getUTCDate()),
      events: days.flatMap((x) => x.events),
      title: p0.month === p4.month ? `${p0.day}.–${p4.day}. ${MONTHS[p4.month - 1]}` : `${p0.day}. ${MON_SHORT[p0.month - 1]} – ${p4.day}. ${MON_SHORT[p4.month - 1]}`,
      range: `${p0.day}.${p0.month}.–${p4.day}.${p4.month}.`,
    });
  }
  return weeks;
}

// ---------- markup ----------

function sessionHTML(e) {
  const s = partsOf(e.start), en = partsOf(e.end);
  const meta = [e.room, hours(e.hours)].filter(Boolean).join(' · ');
  return `<article class="session" data-module="${e.module}" data-start="${e.start}" data-end="${e.end}" data-room="${esc(e.room)}">
${e.exam ? `<span class="session-tag">${esc(e.exam)}</span>` : ''}<p class="session-time"><time datetime="${new Date(e.start).toISOString()}">${hm(s)}</time> – <time datetime="${new Date(e.end).toISOString()}">${hm(en)}</time></p>
<h4 class="session-title">${title(e.name)}</h4>
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
<div class="day-items">${d.events.length ? d.events.map(sessionHTML).join('\n') : '<p class="day-empty">Keine Termine</p>'}</div>
</section>`).join('\n');
  return `<section class="week" id="${w.id}" role="tabpanel" aria-labelledby="tab-${w.id}" data-start="${w.start}" data-end="${w.end}">
<header class="week-head"><h2 class="week-title">${w.title}</h2><p class="week-facts">${facts.join(' · ')}</p></header>
<div class="days" style="--cols: ${w.days.length}">
${days}
</div>
</section>`;
}

function examHTML(e) {
  const s = partsOf(e.start), en = partsOf(e.end);
  return `<li class="exam" data-start="${e.start}" data-end="${e.end}">
<p class="exam-date" aria-hidden="true"><span class="exam-day">${s.day}</span><span class="exam-month">${MON_SHORT[s.month - 1]}</span></p>
<div class="exam-body">
<h3 class="exam-name">${title(e.name)}</h3>
<p class="exam-meta">${weekdayOf(s)}, ${longDate(s)} · ${hm(s)} – ${hm(en)}${e.room ? ' · ' + esc(e.room) : ''}</p>
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
  const meta = next ? (() => { const s = partsOf(next.start), en = partsOf(next.end);
    return [`${weekdayOf(s)}, ${longDate(s)}`, `${hm(s)} – ${hm(en)}`, next.room].filter(Boolean).join(' · '); })() : '';
  return `<section class="now" aria-label="Aktueller Termin" aria-live="polite">
<p class="now-label"><span class="now-pulse" aria-hidden="true"></span><span class="now-label-text">${next ? 'Als Nächstes' : 'Keine Termine'}</span></p>
<${heading} class="now-title">${next ? title(next.name) : 'In Rapla sind für diesen Kurs keine kommenden Termine eingetragen.'}</${heading}>
<p class="now-meta">${esc(meta)}</p>
<p class="now-rel"></p>
<div class="progress" hidden><i></i></div>
</section>`;
}

// The <main> content for one course. `now` only decides what the now card
// says before the script updates it.
export function mainHTML(events, { course, full = '', now = Date.now() } = {}) {
  const { block } = splitBlock(events, now);
  const weeks = toWeeks(block);
  const exams = block.filter((e) => e.exam);
  const lectures = block.filter((e) => !e.exam);

  const roomCounts = {};
  lectures.forEach((e) => { if (e.room) roomCounts[e.room] = (roomCounts[e.room] || 0) + 1; });
  const mainRoom = Object.entries(roomCounts).sort((a, b) => b[1] - a[1])[0];
  const oneRoom = mainRoom && lectures.length >= 4 && mainRoom[1] >= lectures.length * 0.6 ? ` Fast alles in ${esc(mainRoom[0])}.` : '';


  const modules = new Map();
  block.forEach((e) => { if (!modules.has(e.module)) modules.set(e.module, { name: e.moduleName, n: 0 }); modules.get(e.module).n++; });
  const chips = [...modules].filter(([id]) => id !== 'misc').sort((a, b) => b[1].n - a[1].n).map(([id, m]) =>
    `<button class="chip" type="button" data-filter="${id}" aria-pressed="false" title="${esc(m.name)}"><span class="dot" aria-hidden="true"></span><span class="chip-label">${esc(m.name)}</span> <span class="count">${m.n}</span></button>`).join('');

  const tab = (w, copy) => copy
    ? `<span class="tab"><span class="tab-kw">KW ${w.kw}</span><span class="tab-range">${w.range}</span></span>`
    : `<a class="tab${w.end <= now ? ' is-past' : ''}" role="tab" id="tab-${w.id}" href="#${w.id}" aria-controls="${w.id}" aria-selected="false"><span class="tab-kw">KW ${w.kw}</span><span class="tab-range">${w.range}</span></a>`;

  const subtitle = block.length
    ? `Stundenplan der Theoriephase an der DHBW Mannheim, <b>${rangeText(block[0], block.at(-1))}</b>.${oneRoom}`
    : 'Stundenplan an der DHBW Mannheim.';

  return `<div class="wrap">
<section class="intro" aria-labelledby="page-title">
<div>
<h1 class="title" id="page-title">${esc(course)}</h1>
${full ? `<p class="title-full">${esc(full)}</p>` : ''}
<p class="subtitle">${subtitle}</p>
</div>
${nowCardHTML(block, now)}
</section>

${weeks.length ? `<div class="controls">
<nav class="scroller tabs-scroll" aria-label="Wochen">
<div class="tabs-track">
<div class="tabs" role="tablist" aria-label="Woche wählen">${weeks.map((w) => tab(w)).join('')}</div>
<div class="tabs tabs-active" aria-hidden="true">${weeks.map((w) => tab(w, true)).join('')}</div>
</div>
</nav>
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

export function footerHTML(events, { course, fetchedAt = Date.now() } = {}) {
  const { earlier, later } = splitBlock(events, fetchedAt);
  const p = partsOf(fetchedAt);
  let laterText = '';
  if (later.length) {
    const names = [...new Set(later.map((e) => e.name))];
    laterText = names.length <= 3
      ? names.map((n) => {
        const dates = later.filter((e) => e.name === n).map((e) => { const s = partsOf(e.start); return `${s.day}.${s.month}.${s.year}`; });
        return `${esc(n.replace(/ - /, ': '))} am ${dates.join(', ')}`;
      }).join('; ')
      : (() => { const s = partsOf(later[0].start); return `${plural(later.length, 'weiterer Termin', 'weitere Termine')} ab ${longDate(s)} ${s.year}, alle in der Kalenderdatei`; })();
  }
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
    lines.push('BEGIN:VEVENT', `UID:rapla-${e.id}-${course}@dhbw-stundenplan`, `DTSTAMP:${stamp(now)}`, `DTSTART:${stamp(e.start)}`, `DTEND:${stamp(e.end)}`,
      `SUMMARY:${escI(e.name)}`, `LOCATION:${escI(e.room === 'Online' ? 'Online' : ['DHBW Mannheim', e.room].filter(Boolean).join(', '))}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

// ---------- the mensa: Mensaria Metropol and greenes², from /api/mensa ----------

const DAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const euro = (n) => (typeof n === 'number' && n > 0 ? n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }) : '');
const STW = 'https://www.stw-ma.de/essen-trinken/speiseplaene/mensaria-metropol-greenes/';

// Today and the days ahead. Once the counter has closed ("11:30 – 14:00 Uhr")
// today stays in the list, marked `over`, but the card opens on the next day.
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
  const day = days.find((d) => d.key === pick) || days.find((d) => !d.over) || days[0];
  const today = keyOf(partsOf(now)), tomorrow = keyOf(partsOf(now + 864e5));
  const label = (d) => {
    const [y, m, dd] = d.key.split('-').map(Number);
    const wd = DAY_SHORT[(new Date(Date.UTC(y, m - 1, dd)).getUTCDay() + 6) % 7];
    return d.key === today ? 'Heute' : d.key === tomorrow ? 'Morgen' : `${wd} ${dd}.`;
  };
  const url = /^https:\/\/www\.stw-ma\.de\//.test(mensa?.url || '') ? mensa.url : STW;
  const col = (title, list, extra = '') => `<div class="mensa-col"><h3 class="mensa-col-title">${title}</h3>
${list.length ? `<ul class="dishes">${list.map(dishHTML).join('')}</ul>` : '<p class="mensa-none">Nichts eingetragen.</p>'}${extra}</div>`;
  const desserts = day?.desserts?.length ? `<p class="mensa-desserts"><b>Dessert</b> ${esc(day.desserts.map((d) => d.name.trim()).join(' · '))}</p>` : '';
  return `<header class="mensa-head">
<div><h2 class="section-title" id="mensa-title">Mensa</h2>
<p class="mensa-lead">${esc(mensa?.name || 'Mensaria Metropol')}${mensa?.hours ? ` · ${esc(mensa.hours.replace(/\s*Uhr\s*$/, ''))} Uhr` : ''} · Preise für Studierende</p></div>
${days.length > 1 ? `<div class="mensa-days" role="group" aria-label="Tag wählen">${days.map((d) => `<button class="chip" type="button" data-mensa-day="${d.key}" aria-pressed="${d === day}">${label(d)}</button>`).join('')}</div>` : ''}
</header>
${!day ? '<p class="empty-state">Für die nächsten Tage ist noch kein Speiseplan eingetragen.</p>'
    : day.closed ? `<p class="empty-state">${label(day)} ist die Mensa geschlossen.</p>`
      : `${day.over ? `<p class="mensa-note">Die Ausgabe hat heute schon geschlossen${mensa?.hours ? ` (${esc(mensa.hours.replace(/\s*Uhr\s*$/, ''))} Uhr)` : ''}.</p>` : ''}<div class="mensa-grid">
${col('Mensaria Metropol', day.main, desserts)}
${col('greenes²', day.greenes)}
</div>`}
<p class="mensa-more"><a href="${esc(url)}" rel="noopener">Ganzer Speiseplan beim Studierendenwerk</a></p>`;
}

// ---------- the homepage ----------

const FACULTY_ORDER = ['W', 'T', 'G', 'S', 'I'];
const programOf = (name) => (name.match(/^([A-Z]+?)\d{2}/) || [null, name])[1];

// Every course, grouped faculty → programme code → intake year, newest first.
export function directory(courses) {
  const faculties = new Map();
  for (const c of courses) {
    const f = c.name[0];
    if (!faculties.has(f)) faculties.set(f, new Map());
    const programs = faculties.get(f);
    const p = programOf(c.name);
    if (!programs.has(p)) programs.set(p, []);
    programs.get(p).push(c);
  }
  return [...faculties]
    .sort((a, b) => FACULTY_ORDER.indexOf(a[0]) - FACULTY_ORDER.indexOf(b[0]))
    .map(([f, programs]) => ({
      id: f,
      name: FACULTY[f] || f,
      count: [...programs.values()].reduce((n, l) => n + l.length, 0),
      programs: [...programs].map(([code, list]) => {
        const years = new Map();
        list.forEach((c) => { const y = (c.name.match(/\d{2}/) || ['?'])[0]; if (!years.has(y)) years.set(y, []); years.get(y).push(c); });
        return {
          code, count: list.length, degree: (list.find((c) => c.degree) || {}).degree || '',
          years: [...years].sort((a, b) => b[0].localeCompare(a[0])).map(([y, list]) => ({ year: y === '?' ? '' : `20${y}`, courses: list.sort((a, b) => a.name.localeCompare(b.name)) })),
        };
      }).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
    }));
}

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

const SEARCH_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M7 1.5a5.5 5.5 0 0 1 4.38 8.82l3.15 3.15a.75.75 0 1 1-1.06 1.06l-3.15-3.15A5.5 5.5 0 1 1 7 1.5ZM3 7a4 4 0 1 0 8 0 4 4 0 0 0-8 0Z"/></svg>';

// A real piece of the timetable for the hero: one course's now card and its
// next day with lectures. The page script keeps it live like the real plan.
function previewHTML(course, events, now) {
  const { block } = splitBlock(events, now);
  if (!block.length) return '';
  const upcoming = block.find((e) => e.end > now) || block.at(-1);
  const key = keyOf(partsOf(upcoming.start));
  const day = block.filter((e) => keyOf(partsOf(e.start)) === key);
  const p = partsOf(upcoming.start);
  return `<div class="preview" aria-labelledby="preview-title">
<p class="preview-head" id="preview-title"><b>${esc(course)}</b><span>so sieht ein Plan aus</span></p>
${nowCardHTML(block, now, 'h3')}
<section class="day preview-day" data-date="${key}" aria-labelledby="pv${key}">
<h3 class="day-head" id="pv${key}"><span class="day-name">${weekdayOf(p)}</span> <span class="day-date">${p.day}. ${MON_SHORT[p.month - 1]}</span> <span class="today-pill">Heute</span></h3>
<div class="day-items">${day.map(sessionHTML).join('\n').replace(/<h4 class="session-title">/g, '<p class="session-title">').replace(/<\/h4>/g, '</p>')}</div>
</section>
<p class="preview-open"><a href="?kurs=${encodeURIComponent(course)}" data-course-link="${esc(course)}">Ganzen Plan von ${esc(course)} öffnen</a></p>
</div>`;
}

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
<label class="search-field">${SEARCH_ICON}<span class="visually-hidden">Kurs suchen</span>
<input id="hero-search" type="search" placeholder="Kürzel oder Studiengang, z. B. WWI26SEA" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go"
 role="combobox" aria-expanded="false" aria-controls="hero-list" aria-autocomplete="list"></label>
<button class="button search-go" type="button" data-search-go>Plan öffnen</button>
<ul id="hero-list" class="search-list" role="listbox" aria-label="Kurse" hidden></ul>
</div>
<p class="hero-links"><a href="#kurse">Alle Kurse</a><a href="#so-gehts">So funktioniert’s</a><span class="hero-recent" data-recent hidden></span></p>
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
${(() => {
    // faculties with only one or two programmes share a row, so they don't leave half the screen empty
    const section = (f) => `<section class="faculty${f.programs.length < 3 ? ' is-small' : ''}" id="fakultaet-${f.id.toLowerCase()}" aria-labelledby="fak-${f.id}">
<h3 class="faculty-title" id="fak-${f.id}"><span>${esc(f.name)}</span><span class="faculty-count">${plural(f.count, 'Kurs', 'Kurse')}</span></h3>
<ul class="programs">
${f.programs.map(programHTML).join('\n')}
</ul>
</section>`;
    const big = dir.filter((f) => f.programs.length >= 3), small = dir.filter((f) => f.programs.length < 3);
    return big.map(section).join('\n') + (small.length ? `\n<div class="faculty-row">${small.map(section).join('\n')}</div>` : '');
  })()}
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
<div><h2 class="foot-h">Kalender</h2><p>Jeder Plan lässt sich als .ics-Datei laden und in Outlook, Google oder Apple Kalender importieren.</p></div>
<div><h2 class="foot-h">Hinweis</h2><p>Ein inoffizielles Projekt, nicht von der DHBW Mannheim betrieben. Verbindlich bleibt Rapla.</p></div>
</div>
<p class="foot-last"><span>Stundenpläne der DHBW Mannheim</span><a class="button button-small" href="#top">Nach oben</a></p>
</div>`;
}
