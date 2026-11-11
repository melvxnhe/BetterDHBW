// dev.html: the real page against a fake API, with data sets behind a
// switcher at the bottom (Demo, Worst case, Leer, Ein Termin) for testing
// layouts: long titles, overlaps, empty weeks, long names and addresses in
// the chat and the account, a mensa day without dishes, …
// Build only, and never deployed: dev.html stays out of public/.
//
// The data enters where real data does: a script before the page's own
// replaces fetch() for api/… and answers from the chosen set (events of any
// course, the mensa, the account with its notes, the chat). So every view
// works as on the site, including ?kurs=…, ?konto=… and the chat panel.
// The set is chosen with ?data=<name> and kept for the tab (sessionStorage),
// so it survives the page changing its own address.

import { berlin, partsOf, mondayOf } from './render.js';

const DOMAIN = 'student.dhbw-mannheim.de';
const LONG_COURSE = 'WOW23B---VERSORGUNGSWIRTSCHAFT'; // the longest course code in Rapla
const HOUR = 36e5, DAY = 864e5;

// ---------- events (the API's shape) ----------

// A builder for raw events in the week of `monday` (a Date at UTC midnight).
function eventsFrom(monday) {
  let id = 1;
  const at = (day, time) => {
    const d = new Date(+monday + day * DAY);
    const [h, m] = time.split(':').map(Number);
    return new Date(berlin(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), h, m)).toISOString();
  };
  // `toDay`: for entries that run over several days
  return (day, from, to, name, { rooms = ['258B VL-Raum Unterrichtsraum'], type = 'PRESENCE', toDay = day } = {}) =>
    ({ id: 9000000 + id++, name, rooms, type, startTime: at(day, from), endTime: at(toDay, to) });
}

// Three nasty weeks, the first being the one of `now`, so "läuft gerade",
// "heute" and the exam countdowns have something to show.
export function worstEvents(now) {
  const p = partsOf(now);
  const monday = mondayOf(p);
  const today = Math.round((Date.UTC(p.year, p.month - 1, p.day) - +monday) / DAY);
  const ev = eventsFrom(monday);
  const ROOMS3 = ['258B VL-Raum Unterrichtsraum', '180C VL-Raum Unterrichtsraum', 'E 001 Hörsaal Audimax/ SV Auditorium'];
  // twelve modules that each come twice, so the filter has more chips than colours
  const modules = ['Datenbanken', 'Rechnungswesen', 'Statistik', 'Wirtschaftsrecht', 'Marketing', 'Software Engineering I',
    'Programmieren I', 'Business English', 'Logistik und Supply Chain Management', 'Theoretische Informatik', 'Kosten- und Leistungsrechnung', 'IT-Sicherheit'];
  return [
    // today: an all-day entry (Rapla writes these as 00:00 to 00:00) that is an exam, and a long one beside it: two run at once
    ev(today, '00:00', '00:00', 'Prüfung Fallstudie Web-Engineering: Präsentationen aller Gruppen (ganztägig)', { toDay: today + 1 }),
    ev(today, '07:00', '22:00', 'Projektarbeit Software Engineering I – Gruppenarbeit in den Teams (Raumbelegung ganztägig)', { rooms: ROOMS3 }),
    // Monday: the longest realistic title with three rooms, and a project week running to Friday
    ev(0, '08:45', '13:15', 'Projektmanagement und Requirements Engineering in agilen Softwareentwicklungsprojekten (Gruppe A und B, inkl. Prüfungsvorleistung)', { rooms: ROOMS3 }),
    ev(0, '08:00', '17:00', 'Projektwoche Digitale Transformation', { toDay: 4 }),
    ev(0, '15:30', '20:00', '  Grundlagen der   Programmierung  '),
    // Tuesday: six entries, two overlapping, one of 15 minutes, one very late, one with markup characters
    ev(1, '07:30', '08:00', 'Grundlegende Konzepte der IT'),
    ev(1, '08:00', '08:15', 'IT'),
    ev(1, '10:00', '12:00', 'Mathematik I Gruppe A'),
    ev(1, '10:00', '12:00', 'Mathematik I Gruppe B', { rooms: ['067C VL-Raum Unterrichtsraum'] }),
    ev(1, '13:00', '14:30', 'Workshop <Scrum> & Kanban: "Agile" Methoden'),
    ev(1, '18:00', '21:30', 'Effektives Lernen, Präsentieren und Kommunizieren'),
    // Wednesday: no room at all, an online session with its link in the name, Chinese in the title
    ev(2, '09:15', '12:30', 'Begleitetes Selbststudium Mathematik I (MA-WWI26SEA)', { rooms: [] }),
    ev(2, '13:30', '16:00', 'Online-Sprechstunde https://dhbw-mannheim.zoom.us/j/98765432101?pwd=QWxla3NhbmRyYVdpc25pZXdza2E', { rooms: ['MA Online-Veranstaltung'], type: 'ONLINE' }),
    ev(2, '16:15', '17:45', 'Wahlfach Chinesisch für Anfänger 中文入门'),
    // Thursday: one-offs with long names, one German compound without a joint we know
    ev(3, '16:30', '17:30', 'Vorstellung der Studierendenvertretung, Fachschaft Wirtschaftsinformatik & Ersti-Tutorien im Foyer'),
    ev(3, '08:00', '09:30', 'Unternehmensmodellierungswerkzeuge'),
    // Saturday: a make-up session; Sunday: an upload deadline just before midnight (a seven-day week)
    ev(5, '09:00', '12:00', 'Grundlegende Methoden der Wirtschaftsinformatik (Nachholtermin)'),
    ev(6, '23:45', '23:59', 'Abgabe Seminararbeit (Upload in Moodle bis 23:59 Uhr)', { rooms: [] }),
    // week 2 stays empty; week 3 carries the modules and the exams
    ...modules.flatMap((m, i) => [ev(14 + (i % 5), `${String(8 + (i % 3) * 2).padStart(2, '0')}:00`, `${String(9 + (i % 3) * 2).padStart(2, '0')}:30`, m),
      ev(15 + (i % 4), '14:00', '15:30', `Vorlesung ${m}`)]),
    ev(14, '10:00', '12:00', 'Klausur Grundlagen der Betriebswirtschaftslehre und Grundlagen des wissenschaftlichen Arbeitens (Wiederholungsprüfung)', { rooms: ROOMS3 }),
    ev(16, '13:00', '15:00', 'Klausur Mathematik I'),
    ev(18, '08:00', '18:00', 'Prüfungsform Grundlegende Methoden der Wirtschaftsinformatik', { rooms: [] }),
  ];
}

// ---------- the mensa (as api/_dhbw.js trims it) ----------

function mensaWeek(now, days) {
  const p = partsOf(now);
  return days.map((d, i) => {
    const t = new Date(Date.UTC(p.year, p.month - 1, p.day + i));
    return { date: t.toISOString(), closed: false, main: [], greenes: [], desserts: [], ...d };
  });
}

const dish = (name, student = 3.9) => ({ name, student, employee: student && student + 1.5, guest: student && student + 3 });

const MENSA_DEMO = (now) => ({
  name: 'Mensaria Metropol', hours: '11:30 – 14:00 Uhr', url: 'https://www.stw-ma.de/essen-trinken/speiseplaene/mensaria-metropol-greenes/',
  days: mensaWeek(now, [
    { main: [dish('Spaghetti Bolognese, Parmesan', 3.6), dish('Gemüsecurry mit Reis', 3.2)], greenes: [dish('Power bowl: Quinoa, Süßkartoffel, Hummus', 4.9)], desserts: [dish('Schokopudding', 1.2)] },
    { main: [dish('Schnitzel mit Pommes', 4.2)], greenes: [dish('Falafel-Wrap', 4.5)] },
    { main: [dish('Linsen-Dal, Naan', 3.4)], greenes: [dish('Focaccia mit Tomaten', 3.9)] },
  ]),
});

const MENSA_WORST = (now) => ({
  name: 'Mensaria Metropol', hours: '11:30 – 14:00 Uhr', url: 'https://example.com/not-the-studierendenwerk',
  days: mensaWeek(now, [
    {
      main: [
        dish('Hähnchenbrustfilet „Tandoori“ mit Mango-Chutney, Basmatireis, Joghurt-Minz-Dip und Salat vom Buffet', 4.6),
        dish('veganes Chili sin Carne: Kidneybohnen, Mais, Paprika, Reis', 3.2),
        dish('Tagesempfehlung', null),
        dish('Schweinerückensteak mit Pfefferrahmsauce, Pommes frites und Gemüse der Saison (enthält Sellerie, Senf, Milch/Laktose, Weizen/Gluten)', 12.5),
        dish('Rindfleischsuppentopf', 0),
      ],
      greenes: [],
      desserts: [dish('Bio-Joghurt'), dish('Obstsalat'), dish('Tiramisu „Mensaria“ mit Amarettini'), dish('Apfelstrudel mit Vanillesauce'), dish('Mousse au Chocolat'), dish('Rote Grütze')],
    },
    { closed: true },
    {}, // open, but nothing entered at either counter
    { main: [dish('Käsespätzle mit Röstzwiebeln und Salat', 3.9)], greenes: [dish('Superfood-Bowl: Grünkohl, Edamame, Quinoa, Granatapfel, Kürbiskerne, Sesam-Ingwer-Dressing', 5.9)] },
    { main: [dish('Fisch (MSC) im Backteig, Remoulade, Kartoffelsalat', 4.4)] },
  ]),
});

// ---------- the chat ----------

const ago = (now, ms) => new Date(now - ms).toISOString();

function chatWorst(now, me) {
  const ids = { jo: 'aaaaaaaaaaaa', wang: 'bbbbbbbbbbbb', dang: 'cccccccccccc', noor: 'dddddddddddd', guest: 'eeeeeeeeeeee' };
  const lorem = 'Hat jemand die Folien von heute? Ich war krank und im Moodle-Kurs sind nur die vom letzten Mal. Außerdem: gilt die Abgabe für die Fallstudie jetzt bis Sonntag 23:59 oder schon Freitag? Im Rapla steht Sonntag, in der Mail vom Studiengangsleiter stand Freitag, und in der Vorlesung wurde gesagt, dass es egal ist, solange es vor der Präsentation hochgeladen ist. Ich will nur nicht, dass am Ende Punkte abgezogen werden, weil ich mich auf die falsche Angabe verlassen habe. Danke euch!!';
  const list = [];
  let id = 1;
  const add = (room, from, name, body, t, guest = false) => list.push({ id: id++, room, from, name, guest, body, at: ago(now, t) });
  // a long backlog in the room for everyone: the panel holds 200
  for (let i = 0; i < 190; i++) add('global', i % 3 ? ids.jo : ids.wang, i % 3 ? 'Jo' : '王秀英', i % 7 ? `Nachricht ${i + 1}` : 'ok', (8 * DAY) - i * 30 * 60e3);
  add('global', ids.dang, 'Đặng Thị Ngọc Hân', lorem.slice(0, 500), 3 * DAY);
  add('global', ids.noor, 'نور الهدى عبد الرحمن', 'مرحبا بالجميع! هل المحاضرة غدا في القاعة 258B؟', DAY + 2 * HOUR);
  add('global', ids.guest, 'Gast 4821', 'https://moodle.dhbw-mannheim.de/mod/assign/view.php?id=1234567&action=grading&tsort=lastname&tdir=4&filter=submitted&perpage=100', DAY);
  add('global', me.id, me.name, 'Datenschutzgrundverordnungsumsetzungsworkshop ist morgen, nicht heute.', 5 * HOUR);
  add('global', ids.jo, 'Jo', '<script>alert(1)</script> &amp; **fett**', 2 * HOUR, false);
  add('global', ids.jo, 'Jo', '👩🏽‍💻🔥🔥🔥', 2 * HOUR - 60e3);
  add('global', me.id, me.name, 'Zeile eins\nZeile zwei\n\n\nZeile fünf nach drei Leerzeilen', 40 * 60e3);
  add('global', ids.wang, '王秀英', 'k', 60e3);
  add(LONG_COURSE, me.id, me.name, lorem.slice(0, 500), 30 * 60e3);
  return list;
}

// ---------- the data sets ----------

// `base`: the preview course's raw events. Each set: the course the "Kurs"
// link opens, the events every course answers with, the mensa, the account
// (user null: signed out) with its notes, and the chat.
export function devData(base, now) {
  const worst = worstEvents(now);
  const id = (name) => String(worst.find((e) => e.name === name || e.name.startsWith(name)).id);
  const longEmail = `aleksandra.wisniewska-kowalczyk.wirtschaftsinformatik26@${DOMAIN}`; // 56 characters before the @ (64 allowed)
  const worstUser = { email: longEmail, name: 'Aleksandra Wiśniewska-K.' }; // 24 characters, the most a name may have
  const longNote = 'Folien Kapitel 4–7 wiederholen, besonders das Beispiel mit dem Kanban-Board. '.repeat(26).slice(0, 2000); // the limit
  return {
    'Demo': {
      course: 'WWI26SEA',
      events: base,
      mensa: MENSA_DEMO(now),
      user: { email: `lena.schmidt@${DOMAIN}`, name: 'Lena' },
      settings: { course: 'WWI26SEA', recent: ['WWI26SEA', 'WWI26SEB'] },
      notes: base.length ? [{ course: 'WWI26SEA', eventId: String(base[0].id), eventName: String(base[0].name).trim(), eventStart: base[0].startTime, body: 'Laptop mitbringen.', updatedAt: ago(now, DAY) }] : [],
      guests: true,
      messages: [
        { id: 1, room: 'global', from: 'aaaaaaaaaaaa', name: 'Tim', guest: false, body: 'Weiß jemand, ob Mathe morgen stattfindet?', at: ago(now, 3 * HOUR) },
        { id: 2, room: 'global', from: 'me', name: 'Lena', guest: false, body: 'Ja, laut Rapla schon.', at: ago(now, 2 * HOUR) },
      ],
    },
    'Worst case': {
      course: LONG_COURSE,
      events: worst,
      mensa: MENSA_WORST(now),
      user: worstUser,
      settings: { course: LONG_COURSE, recent: [LONG_COURSE, 'TMB22PJM-NES', 'TWIW22DT-CV', 'WWI23IMBITB', 'WWI26SEA'] },
      notes: [
        { course: LONG_COURSE, eventId: id('Projektmanagement und Requirements'), eventName: worst[2].name, eventStart: worst[2].startTime, body: longNote, updatedAt: ago(now, HOUR) },
        { course: LONG_COURSE, eventId: id('Online-Sprechstunde'), eventName: 'Online-Sprechstunde', eventStart: null, body: 'https://dhbw-mannheim.zoom.us/j/98765432101?pwd=QWxla3NhbmRyYVdpc25pZXdza2E', updatedAt: ago(now, HOUR) },
        { course: LONG_COURSE, eventId: id('IT'), eventName: '', eventStart: null, body: '<b>nicht fett</b>\n\nzweiter Absatz', updatedAt: ago(now, HOUR) },
        { course: 'TMB22PJM-NES', eventId: '1', eventName: 'X', eventStart: ago(now, 400 * DAY), body: '.', updatedAt: ago(now, HOUR) },
      ],
      guests: true,
      messages: chatWorst(now, { id: 'me', name: worstUser.name }),
    },
    'Leer': {
      course: 'WWI26SEA',
      events: [],
      mensa: { name: 'Mensaria Metropol', hours: '', url: '', days: [] },
      user: null,
      settings: null,
      notes: [],
      guests: false,
      messages: [],
    },
    'Ein Termin': {
      course: 'WWI26SEA',
      events: base.slice(0, 1),
      mensa: { name: 'Mensaria Metropol', hours: '11:30 – 14:00 Uhr', url: '', days: mensaWeek(now, [{ main: [dish('Pasta')] }]) },
      user: { email: `jo@${DOMAIN}`, name: null },
      settings: { recent: [] },
      notes: [],
      guests: true,
      messages: [{ id: 1, room: 'global', from: 'aaaaaaaaaaaa', name: 'Jo', guest: false, body: 'a', at: ago(now, 60e3) }],
    },
  };
}

// ---------- in the page ----------

// goes into <head>
export const DEV_STYLE = `<style>
.devbar { position: fixed; left: 50%; bottom: calc(16px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%); z-index: 99;
  display: flex; flex-wrap: wrap; justify-content: center; gap: 4px; align-items: center; width: max-content; max-width: calc(100vw - 24px);
  padding: 6px; border-radius: 14px; background: #e5e5ea; font: 13px/1 system-ui, sans-serif; color: #1d1d1f; box-shadow: 0 4px 16px rgb(0 0 0 / .16); }
.devbar a { border-radius: 9px; padding: 8px 10px; color: inherit; text-decoration: none; }
.devbar a[aria-current="true"] { background: #fff; font-weight: 600; }
.devbar hr { width: 1px; height: 18px; margin: 0 2px; border: 0; background: #c7c7cc; }
body.has-devbar .chat { bottom: 96px; }
body.has-devbar .foot { padding-bottom: 180px; }
body:has(.chat.is-open, dialog[open]) .devbar { display: none; }
</style>`;

// The fake API. Runs in the browser before the page's script; put into the
// page with toString(), so it uses nothing from this file.
function devApi() {
  const sets = JSON.parse(document.getElementById('dev-data').textContent);
  const params = new URLSearchParams(location.search);
  const store = (k, v) => { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch { /* private mode */ } return null; };
  let name = params.get('data');
  if (!sets[name]) name = store('dev-data');
  if (!sets[name]) name = Object.keys(sets)[0];
  store('dev-data', name);
  const set = sets[name];
  window.__dev = { set: name, course: set.course };

  // what the page changes (signing out, notes, messages) lasts for the tab
  const outKey = `dev-out:${name}`;
  const signedIn = () => !!set.user && store(outKey) !== '1';
  let user = set.user && { ...set.user };
  const notes = new Map(set.notes.map((n) => [`${n.course}|${n.eventId}`, n]));
  const messages = [...set.messages];
  const guestYou = { id: 'guest', name: 'Gast 1234', guest: true, named: false };
  const you = () => (signedIn() ? { id: 'me', name: user.name || 'Nutzer 5821', guest: false, named: !!user.name } : set.guests ? guestYou : null);

  const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'x-dhbw-proxy': '1' } });
  const real = window.fetch.bind(window);

  const routes = {
    'mensa': () => (set.mensa ? json(200, set.mensa) : json(502, {})),
    'account/me': () => json(200, { user: signedIn() ? user : null, settings: signedIn() ? set.settings : null }),
    'account/login': () => { store(outKey, '0'); user = user || { email: 'test@student.dhbw-mannheim.de', name: null }; set.user = user; return json(200, { user, settings: set.settings || {} }); },
    'account/register': (b) => json(202, { ok: true, message: `Wenn ${b.email} registriert werden kann, ist eine E-Mail unterwegs. Der Link darin gilt 24 Stunden.` }),
    'account/forgot': (b) => json(202, { ok: true, message: `Wenn es für ${b.email || 'diese Adresse'} ein Konto gibt, ist eine E-Mail mit einem Link unterwegs. Er gilt eine Stunde.` }),
    'account/logout': () => { store(outKey, '1'); return json(200, { ok: true }); },
    'account/logout-all': () => { store(outKey, '1'); return json(200, { ok: true }); },
    'account/delete': () => { store(outKey, '1'); return json(200, { ok: true }); },
    'account/password': () => json(200, { ok: true, message: 'Passwort geändert. Auf anderen Geräten bist du jetzt abgemeldet.' }),
    'account/name': (b) => { user = { ...user, name: String(b.name).trim() }; return json(200, { user }); },
    'account/settings': (b) => json(200, { settings: b.settings }),
    'account/export': () => json(200, { user, notes: [...notes.values()] }),
    'account/notes': (b, q) => json(200, { notes: [...notes.values()].filter((n) => !q.get('course') || n.course === q.get('course')) }),
    'account/note': (b) => {
      const key = `${b.course}|${b.eventId}`;
      if (!b.body.trim()) { notes.delete(key); return json(200, { note: null }); }
      const note = { course: b.course, eventId: b.eventId, eventName: b.eventName, eventStart: b.eventStart, body: b.body, updatedAt: new Date().toISOString() };
      notes.set(key, note);
      return json(200, { note });
    },
    'chat/me': () => json(200, { you: you(), guests: set.guests, max: 500 }),
    'chat/messages': (b, q) => json(200, { room: q.get('room'), messages: q.get('after') ? messages.filter((m) => m.room === q.get('room') && m.id > +q.get('after')) : messages.filter((m) => m.room === q.get('room')).slice(-200) }),
    'chat/send': (b) => {
      const from = you();
      if (!from) return json(401, { message: 'Bitte melde dich an.' });
      const m = { id: messages.length + 1000, room: b.room, from: from.id, name: from.name, guest: from.guest, body: b.body, at: new Date().toISOString() };
      messages.push(m);
      return json(200, { message: m, you: from });
    },
  };

  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    const at = url.pathname.indexOf('/api/');
    if (at < 0) return real(input, init);
    const path = url.pathname.slice(at + 5);
    await new Promise((r) => setTimeout(r, 150)); // about as long as the network
    let body = {};
    try { body = init.body ? JSON.parse(init.body) : {}; } catch { /* not JSON */ }
    if (/^rapla\/lectures\/[^/]+\/events$/.test(path)) return json(200, set.events);
    return routes[path] ? routes[path](body, url.searchParams) : json(404, { message: 'Gibt es in dev.html nicht.' });
  };

  // In the console: __overflow() lists what sticks out sideways (the page
  // should never scroll horizontally; the scrolling rows are left out).
  window.__overflow = () => {
    const width = document.documentElement.clientWidth;
    const out = [];
    document.querySelectorAll('body *').forEach((el) => {
      if (el.closest('[hidden], .visually-hidden, .devbar, svg, script, style')) return;
      if (el.parentElement?.closest('.scroller, .chat-rooms, .mensa-days')) return;
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > width + 1 || r.left < -1)) out.push(`${el.tagName.toLowerCase()}.${el.className} ${Math.round(r.left)}–${Math.round(r.right)}: ${el.textContent.trim().slice(0, 40)}`);
    });
    return { width, page: document.documentElement.scrollWidth, out };
  };

  // the switcher: data sets, then the views; each link loads the page anew
  const link = (query, text, current) => `<a href="?${new URLSearchParams(query)}" aria-current="${current}">${text}</a>`;
  const view = params.has('konto') ? `konto=${params.get('konto')}` : params.has('kurs') ? 'kurs' : 'start';
  const keep = Object.fromEntries([...params].filter(([k]) => k === 'kurs' || k === 'konto'));
  document.addEventListener('DOMContentLoaded', () => {
    const bar = document.createElement('nav');
    bar.className = 'devbar';
    bar.setAttribute('aria-label', 'Testdaten (nur Entwicklung)');
    bar.innerHTML = Object.keys(sets).map((n) => link({ data: n, ...keep }, n, n === name)).join('')
      + '<hr>' + [['start', 'Start', {}], ['kurs', 'Kurs', { kurs: set.course }], ['konto=konto', 'Konto', { konto: 'konto' }], ['konto=registrieren', 'Registrieren', { konto: 'registrieren' }]]
        .map(([v, text, q]) => link({ data: name, ...q }, text, v === view)).join('');
    document.body.append(bar);
    document.body.classList.add('has-devbar');
  });
}

// Goes before the page's script: the data sets and the fake API.
export const devTail = (sets) => `<script type="application/json" id="dev-data">${JSON.stringify(sets).replace(/</g, '\\u003c')}</script>
<script>(${devApi.toString()})();</script>`;
