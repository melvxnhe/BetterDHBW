// The Freistunden-Matcher at ?frei=A,B: pick two courses and see, a week at a
// time, when both of you are free. The comparing itself is in render.js
// (matchHTML); this file is the view around it: the two course pickers, the
// address, loading both plans, and keeping the "next" card current.
//
// setupMatch({ swap, start, fetchEvents, byName, combobox }) returns
// { route, open, tick }:
// - swap, start, fetchEvents: from app.js (show a view, mount a plan, load a course)
// - combobox(open, current): a course search (search.js) that calls
//   open(name) with the pick; current() is the course not to offer again
// - route(params): shows the matcher if the address asks for it, else false
// - open(names, { animate }): opens it with these courses picked (a link)
// - tick(): every minute, while it is on screen
function setupMatch({ swap, start, fetchEvents, byName, combobox }) {
  const TITLE = 'Freistunden · Stundenpläne der DHBW Mannheim';
  const LABELS = ['Dein Kurs', 'Der andere Kurs'];
  let picked = [null, null];
  let shown = null;  // { weeks }: the comparison on screen, for tick()
  let token = 0;     // counts comparisons, so a slow answer can tell it is no longer wanted

  const urlOf = (names) => `?frei=${names.filter(Boolean).map(encodeURIComponent).join(',')}`;
  const namesOf = (params) => (params.get('frei') || '').split(',').map((n) => n.trim().toUpperCase()).filter((n) => byName.has(n)).slice(0, 2);
  const out = () => document.querySelector('[data-match-out]');

  // The search icon of the header, so both fields look like every other course search.
  const icon = () => document.querySelector('.bar .search-field svg')?.outerHTML || '';

  const pageHTML = () => `<div class="wrap match">
<section class="intro match-intro" aria-labelledby="page-title"><div>
<h1 class="title" id="page-title">Freistunden</h1>
<p class="subtitle">Zwei Kurse, eine Woche: wann ihr beide frei habt. Für die Mittagspause, eine Lerngruppe oder einen Kaffee.</p>
</div></section>
<div class="match-pick" role="group" aria-label="Kurse wählen">
${LABELS.map((label, i) => `<div class="search match-field">
<label class="match-label" for="match-${i}">${label}</label>
<label class="search-field">${icon()}<input id="match-${i}" type="search" placeholder="Kürzel, z. B. WWI26SEA" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go"
 role="combobox" aria-expanded="false" aria-controls="match-${i}-list" aria-autocomplete="list"></label>
<ul id="match-${i}-list" class="search-list" role="listbox" aria-label="Kurse" hidden></ul>
</div>`).join('\n')}
</div>
<div class="match-out" data-match-out></div>
</div>`;

  const hint = (text) => `<p class="empty-state match-hint">${text}</p>`;

  // ---------- the two pickers ----------

  function wire() {
    LABELS.forEach((label, i) => {
      const input = document.getElementById(`match-${i}`);
      input.value = picked[i] || '';
      // Focused, the field empties so the list shows recent and related courses;
      // it shows the pick again when left without choosing. Registered before
      // the combobox, so its list already sees the empty field.
      input.addEventListener('focus', () => { input.placeholder = picked[i] || 'Kürzel, z. B. WWI26SEA'; input.value = ''; });
      input.addEventListener('blur', () => { input.value = picked[i] || ''; });
      combobox((name) => choose(i, name), () => picked[1 - i])(input, document.getElementById(`match-${i}-list`));
    });
  }

  function choose(i, name) {
    picked[i] = name;
    document.getElementById(`match-${i}`).value = name;
    history.replaceState({ frei: picked }, '', urlOf(picked)); // a new pair: the week from the address no longer applies
    compare();
    // the other one still missing: straight on to it
    if (!picked[1 - i]) document.getElementById(`match-${1 - i}`).focus();
  }

  // ---------- comparing ----------

  async function compare() {
    shown = null;
    const mine = ++token;
    if (!picked[0] || !picked[1]) {
      out().innerHTML = hint(picked[0] || picked[1] ? 'Jetzt noch den zweiten Kurs wählen.' : 'Wähle zwei Kurse. Dann siehst du Woche für Woche, wann ihr beide frei habt.');
      start();
      return;
    }
    out().innerHTML = hint('Beide Pläne werden geladen …');
    out().setAttribute('aria-busy', 'true');
    try {
      const [a, b] = await Promise.all(picked.map((name) => fetchEvents(byName.get(name))));
      if (mine !== token) return;
      const now = Date.now();
      out().innerHTML = matchHTML(a.events, b.events, { names: picked, now });
      shown = { weeks: matchWeeks(a.events, b.events, now) };
      start(); // timetable.js: week tabs, today
    } catch {
      if (mine !== token) return;
      out().innerHTML = `<div class="empty-state error-state" role="alert"><p>Die Pläne konnten gerade nicht geladen werden. Ohne Verbindung geht es nur mit Kursen, die du auf diesem Gerät schon geöffnet hast.</p>
<p class="error-actions"><button class="button" type="button" data-match-retry>Erneut versuchen</button></p></div>`;
      out().querySelector('[data-match-retry]').addEventListener('click', compare);
    } finally {
      if (mine === token) out().removeAttribute('aria-busy');
    }
  }

  // ---------- the view ----------

  function show(names, { push, animate }) {
    picked = [names[0] || null, names[1] || null];
    if (picked[0] === picked[1]) picked[1] = null;
    if (push) history.pushState({ frei: picked }, '', urlOf(picked));
    swap({ view: 'match', name: null, main: pageHTML(), foot: '', title: TITLE, animate });
    wire();
    compare();
    // nothing picked yet: straight into the first field
    const empty = picked.findIndex((n) => !n);
    if (empty >= 0 && matchMedia('(pointer: fine)').matches) document.getElementById(`match-${empty}`).focus({ preventScroll: true });
  }

  return {
    route(params) {
      if (!params.has('frei')) return false;
      show(namesOf(params), { push: false, animate: false });
      return true;
    },
    open(names, { animate = false } = {}) {
      show(names, { push: true, animate });
    },
    // The "next" card counts down with the clock; the rest only changes with the data.
    tick() {
      const card = document.querySelector('[data-match-next]');
      if (!shown || !card || document.body.dataset.view !== 'match') return;
      const html = matchNextHTML(shown.weeks, Date.now());
      if (card.outerHTML !== html) card.outerHTML = html;
    },
  };
}
