// The page itself: which view is on screen (the homepage, a course, an
// account page), opening courses in place, and keeping what is shown in step
// with the clock and with Rapla. The parts live in their own files and are
// set up here: timetable.js (a plan's live state), search.js, mensa.js,
// pwa.js (install and offline), chat.js, settings.js (the theme), account.js.
// render.js makes the markup.
//
// build.mjs joins these files into one script in the page; this one runs last.
(() => {
  const MINUTE = 60 * 1000;
  const REFRESH = 10 * MINUTE; // how often the course on screen is fetched again
  const RETRY = MINUTE;        // after a failed fetch, or when the answer was a saved copy
  const RECENT = 'dhbw-ma-zuletzt'; // localStorage: the names of the courses opened last
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  const catalog = JSON.parse(document.getElementById('course-data')?.textContent || '{"courses":[]}');
  const courses = catalog.courses;
  const byName = new Map(courses.map((c) => [c.name, c]));
  const isDev = !!window.__dev; // dev.html: a fake API with test data (src/dev.js), and no service worker
  const bar = document.querySelector('.bar');
  const onHome = () => document.body.dataset.view === 'home';
  const courseUrl = (name) => `?kurs=${encodeURIComponent(name)}`;

  let view = null;    // the plan mounted by timetable.js
  let current = null; // the course on screen; null on the homepage and the account pages
  let shown = null;   // { name, sig, due }: that course, what Rapla said last, and when to ask again
  let loadToken = 0;  // counts navigations, so a slow answer can tell it is no longer wanted
  let icsUrl = null;
  let account = null; // the hooks from setupAccounts (account.js)

  // ---------- the clock ----------

  const mount = setupTimetable();

  function start() {
    view?.destroy();
    document.documentElement.classList.replace('no-js', 'js');
    view = mount(document);
  }

  // One clock for the page: on every full minute, and whenever the page comes
  // back (tab shown again, phone unlocked, laptop woken, restored from the
  // back/forward cache, network back). Timers in background tabs are throttled
  // or frozen, so the minute tick alone would leave a stale page behind.
  function sync() {
    refreshCourse();
    renderPreview();
    refreshSample();
    mensa.load();
    mensa.render();
    view?.update();
  }

  function tick() {
    sync();
    setTimeout(tick, MINUTE - (Date.now() % MINUTE) + 50);
  }

  window.__timetable = { start, update: sync }; // for dev.html and for poking at the page in the console
  start();
  setTimeout(tick, MINUTE - (Date.now() % MINUTE) + 50);

  // the homepage as shipped; coming back to it later skips the first-load entrance
  const home = { main: document.querySelector('main').innerHTML.replace('class="home" data-enter', 'class="home"'), foot: document.querySelector('.foot').innerHTML, title: document.title };

  // ---------- recently opened courses (on this device; account.js syncs them) ----------

  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
  const recent = () => read(RECENT, []).filter((n) => byName.has(n));
  const remember = (name) => write(RECENT, [name, ...recent().filter((n) => n !== name)].slice(0, 5));

  // ---------- fetching a course ----------

  class LoadError extends Error {}

  // { events, saved }: saved is when the copy was stored if the service worker
  // answered from its cache (offline), else null
  async function fetchEvents(course) {
    let events = [], saved = null;
    for (const id of course.ids) {
      let res;
      try {
        res = await fetch(`api/rapla/lectures/${encodeURIComponent(id)}/events`, { headers: { Accept: 'application/json' } });
      } catch {
        throw new LoadError('offline'); // no network and nothing saved for this course
      }
      // serve.mjs marks its answers; anything else is a plain static server
      if (!res.headers.has('x-dhbw-proxy')) throw new LoadError('server');
      if (!res.ok) throw new LoadError('upstream');
      events = normalize(await res.json());
      saved = res.headers.has('x-sw-offline') ? +res.headers.get('x-sw-saved') || null : null;
      if (events.length) break; // the older Rapla id may be empty; try the next
    }
    return { events, saved };
  }

  // ---------- what a course page shows besides its plan ----------

  // "Keine Verbindung · Stand 5. Nov., 09:56 Uhr": under the title while
  // the plan on screen is a saved copy, removed once fresh data arrives
  const fSaved = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  function setOffline(saved) {
    document.querySelector('.offline-note')?.remove();
    const anchor = document.querySelector('.intro .subtitle');
    if (!saved || !anchor) return;
    const note = document.createElement('p');
    note.className = 'offline-note';
    note.setAttribute('role', 'status');
    note.textContent = `Keine Verbindung · Stand ${fSaved.format(saved)} Uhr`;
    anchor.after(note);
  }

  // every "Kalender laden" link gets the course's events as a file
  function setIcs(name, events) {
    if (icsUrl) URL.revokeObjectURL(icsUrl);
    icsUrl = URL.createObjectURL(new Blob([icsFor(name, events)], { type: 'text/calendar' }));
    document.querySelectorAll('[data-ics]').forEach((a) => {
      a.href = icsUrl;
      a.download = `${name.toLowerCase()}.ics`;
    });
  }

  function setLoading(on) {
    const main = document.querySelector('main');
    if (on) main.setAttribute('aria-busy', 'true');
    else main.removeAttribute('aria-busy');
    main.classList.toggle('is-loading', on);
    bar.classList.toggle('is-loading', on);
  }

  // ---------- views ----------

  // Swap the page. Choices made by pointer fade in so content doesn't
  // teleport; keyboard choices and history steps stay instant.
  // `foot: null` keeps the footer that is there.
  function swap({ view: kind, name, main, foot, title, animate }) {
    shown = null;
    const m = document.querySelector('main');
    m.innerHTML = main;
    if (foot !== null) document.querySelector('.foot').innerHTML = foot;
    document.body.dataset.view = kind;
    document.querySelectorAll('[data-course-name]').forEach((el) => { el.textContent = name || 'Stundenplan'; });
    document.title = title;
    current = name;
    window.scrollTo({ top: 0, behavior: 'instant' });
    start();
    setupPage();
    if (animate) m.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease' });
  }

  function showHome({ push = true, animate = false } = {}) {
    loadToken++; // a course still loading no longer opens
    setLoading(false);
    swap({ view: 'home', name: null, main: home.main, foot: home.foot, title: home.title, animate });
    if (push) history.pushState({}, '', location.pathname);
  }

  const ERRORS = {
    server: 'Kurse lassen sich nur laden, wenn die Seite über <b>start.cmd</b> (oder <code>npm start</code>) läuft. api.dhbw.app erlaubt keine Abrufe direkt aus dem Browser, der lokale Server reicht sie weiter.',
    offline: 'Keine Verbindung. Diesen Kurs hast du auf diesem Gerät noch nicht geöffnet, deshalb gibt es keinen gespeicherten Stand. Sobald du wieder online bist, lädt er von selbst.',
    upstream: 'api.dhbw.app hat gerade nicht geantwortet. Später noch einmal versuchen.',
  };

  function showError(name, kind, retry) {
    swap({ view: 'course', name, title: `${name} Stundenplan`, foot: null, animate: false, main: `<div class="wrap"><section class="intro" aria-labelledby="page-title"><div>
<h1 class="title" id="page-title">${esc(name)}</h1>
<p class="subtitle">Der Stundenplan konnte nicht geladen werden.</p></div></section>
<div class="empty-state error-state" role="alert"><p>${ERRORS[kind] || ERRORS.upstream}</p>
<p class="error-actions"><button class="button" type="button" data-retry>Erneut versuchen</button>
<a href="./" data-home>Zur Startseite</a></p></div></div>` });
    document.querySelector('[data-retry]').addEventListener('click', retry);
  }

  // Opens a course in place. `push: false` when the address already names it
  // (first load, back/forward, retry).
  async function loadCourse(name, { push = true, animate = true } = {}) {
    const course = byName.get(name);
    if (!course) return false;
    const token = ++loadToken;
    const address = () => { if (push) history.pushState({ kurs: course.name }, '', courseUrl(course.name)); };
    setLoading(true);
    try {
      const { events, saved } = await fetchEvents(course);
      if (token !== loadToken) return false;
      const now = Date.now();
      // the address changes first, so the new plan doesn't pick up the old course's week anchor
      address();
      swap({ view: 'course', name: course.name, title: `${course.name} Stundenplan`, animate,
        main: mainHTML(events, { course: course.name, full: course.full, now }), foot: footerHTML(events, { course: course.name, fetchedAt: saved || now }) });
      setIcs(course.name, events);
      setOffline(saved);
      shown = { name: course.name, sig: JSON.stringify(events), due: now + (saved ? RETRY : REFRESH) };
      remember(course.name);
      account?.courseShown(course.name);
      return true;
    } catch (err) {
      if (token !== loadToken) return false;
      address();
      showError(course.name, err instanceof LoadError ? err.message : 'upstream', () => loadCourse(course.name, { push: false }));
      return false;
    } finally {
      if (token === loadToken) setLoading(false);
    }
  }

  // ---------- staying in sync with Rapla while the page stays open ----------

  let refreshing = false;

  // Every ten minutes (checked on each tick, and when the tab comes back) the
  // open course is fetched again. Only a real change redraws the plan, in
  // place: same week, same filter, same scroll position, and without motion,
  // because nobody asked for it.
  async function refreshCourse() {
    const mine = shown;
    if (!mine || refreshing || document.hidden || Date.now() < mine.due) return;
    refreshing = true;
    const token = loadToken;
    try {
      const { events, saved } = await fetchEvents(byName.get(mine.name));
      if (token !== loadToken || shown !== mine) return;
      const now = Date.now();
      mine.due = now + (saved ? RETRY : REFRESH);
      document.querySelector('.foot').innerHTML = footerHTML(events, { course: mine.name, fetchedAt: saved || now });
      setIcs(mine.name, events);
      const sig = JSON.stringify(events);
      if (sig === mine.sig) { setOffline(saved); return; }
      mine.sig = sig;
      const keep = view?.filterId || 'all', y = scrollY;
      document.querySelector('main').innerHTML = mainHTML(events, { course: mine.name, full: byName.get(mine.name).full, now });
      start();
      view.filter(keep);
      mensa.render();
      setOffline(saved);
      account?.decorate();
      scrollTo({ top: y, behavior: 'instant' });
    } catch {
      mine.due = Date.now() + RETRY; // offline or API down
    } finally {
      refreshing = false;
    }
  }

  // ---------- the preview on the homepage ----------

  // Drawn in the browser from the course's data, so it always shows the next
  // day with lectures, not the day the site was built. The data shipped with
  // the page is refreshed from Rapla right away.
  const sample = { name: catalog.sample?.name || null, events: normalize(catalog.sample?.raw || []), key: null, due: 0 };

  function renderPreview(force = false) {
    const stage = document.querySelector('.hero-stage');
    if (current !== null || !stage || !sample.name) return;
    const now = Date.now();
    const { block } = splitBlock(sample.events, now);
    const next = block.length ? previewEvent(block, now) : null;
    const key = next ? keyOf(partsOf(next.start)) : '';
    if (!force && key === sample.key) return; // still the same day: the clock keeps it live
    sample.key = key;
    // Rapla has nothing (more) for the sample course: no preview rather than the one from the build
    const html = previewHTML(sample.name, sample.events, now);
    stage.hidden = !html;
    stage.closest('.hero')?.classList.toggle('is-single', !html);
    stage.innerHTML = html;
    start();
  }

  async function refreshSample() {
    const course = byName.get(sample.name);
    if (current !== null || !course || document.hidden || Date.now() < sample.due) return;
    sample.due = Date.now() + REFRESH;
    try {
      const { events } = await fetchEvents(course);
      if (JSON.stringify(events) === JSON.stringify(sample.events)) return;
      sample.events = events;
      renderPreview(true);
    } catch {
      sample.due = Date.now() + RETRY;
    }
  }

  // ---------- the parts ----------

  const mensa = setupMensa();

  // Everything on screen is fetched again right away instead of at its next check.
  function refetch() {
    if (shown) shown.due = 0;
    sample.due = 0;
    mensa.expire();
    sync();
  }

  const pwa = setupPwa({ worker: !isDev, onTakeover: refetch });

  const combobox = setupSearch({ courses, byName, recent, current: () => current, open: loadCourse });
  const headerInput = document.getElementById('course-search');
  if (headerInput) combobox(headerInput, document.getElementById('course-list'));

  setupSettings();

  const chat = setupChat({ recent, current: () => current });

  account = setupAccounts({
    swap, showHome, loadCourse, byName, recent,
    setRecent: (list) => write(RECENT, list),
    getCurrent: () => current,
    onAuth: () => chat.identityChanged(),
  });
  // the chat needs the same database as the accounts: no button without it
  account.available.then((yes) => { if (yes) chat.enable(); });

  // ---------- getting around ----------

  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  addEventListener('pageshow', (e) => { if (e.persisted) sync(); });

  // Network back: a course that failed loads by itself, and saved copies on
  // screen are replaced right away.
  addEventListener('online', () => {
    document.querySelector('[data-retry]')?.click();
    refetch();
  });

  // links to courses and to the homepage swap the view instead of loading the page again
  document.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button > 0) return;
    const link = e.target.closest('[data-course-link], [data-home]');
    if (!link) return;
    e.preventDefault();
    if (link.hasAttribute('data-home')) {
      // from a course or an account page; on the homepage itself the logo scrolls to the top
      if (!onHome()) showHome({ animate: e.detail !== 0 });
      else window.scrollTo({ top: 0, behavior: reduceMotion.matches ? 'instant' : 'smooth' });
    } else {
      loadCourse(link.dataset.courseLink, { animate: e.detail !== 0 });
    }
  });

  addEventListener('popstate', () => {
    const params = new URLSearchParams(location.search);
    if (account.route(params)) return;
    const name = (params.get('kurs') || '').toUpperCase();
    if (byName.has(name)) { if (name !== current) loadCourse(name, { push: false, animate: false }); }
    else if (!onHome()) showHome({ push: false });
  });

  // "/" focuses a search from anywhere: the big one on the homepage, else the header's
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    e.preventDefault();
    (document.getElementById('hero-search') || headerInput)?.focus();
  });

  // ---------- after every swap: what the new view needs ----------

  let pageObservers = [];

  function setupPage() {
    pageObservers.forEach((o) => o.disconnect());
    pageObservers = [];
    bar.classList.remove('show-search');

    // every page has a mensa slot: draw what is known, fetch if it's due
    mensa.render();
    mensa.load();
    pwa.showInstall();
    chat.rooms(); // the course on screen is one of the chat's rooms

    if (document.getElementById('hero-search')) setupHome();
  }

  // the homepage adds its own search, the recent courses and the reveals
  function setupHome() {
    const heroInput = document.getElementById('hero-search');
    combobox(heroInput, document.getElementById('hero-list'), document.querySelector('[data-search-go]'));

    // the preview as of now, then fresh data from Rapla
    renderPreview(true);
    refreshSample();

    const slot = document.querySelector('[data-recent]');
    const last = recent().slice(0, 3);
    if (slot && last.length) {
      slot.innerHTML = `Zuletzt: ${last.map((n) => `<a href="${courseUrl(n)}" data-course-link="${esc(n)}">${esc(n)}</a>`).join(' ')}`;
      slot.hidden = false;
    }

    // the header's search appears once the big one has scrolled away
    const watch = new IntersectionObserver(([e]) => bar.classList.toggle('show-search', !e.isIntersecting && e.boundingClientRect.top < 0));
    watch.observe(heroInput.closest('.search'));
    pageObservers.push(watch);

    // Sections rise in once as they arrive: a page seen now and then, not
    // every few minutes, so the entrance is allowed. Never on reduced motion.
    if (reduceMotion.matches || !('IntersectionObserver' in window)) return;
    const reveal = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add('is-in');
      reveal.unobserve(e.target);
    }), { rootMargin: '0px 0px -8% 0px' });
    document.querySelectorAll('.home [data-reveal]').forEach((el) => {
      // what is already on screen stays put; only what is below the fold waits
      if (el.getBoundingClientRect().top < innerHeight) return;
      el.classList.add('will-reveal');
      reveal.observe(el);
    });
    pageObservers.push(reveal);
  }

  // ---------- first view: an account page or a course from the address, else the homepage ----------

  const params = new URLSearchParams(location.search);
  const wanted = (params.get('kurs') || '').toUpperCase();
  // Launched as an installed app without a course in the address, the app
  // opens the course used last: that's what it's for. Once per launch, so the
  // homepage stays reachable through the logo.
  const last = pwa.launchedAsApp && !wanted && !location.hash ? recent()[0] : null;
  const first = byName.has(wanted) ? wanted : last;
  if (account.route(params)) {
    // ?konto=…: sign-in, sign-up, e-mail links, the account page
  } else if (first) {
    if (first !== wanted) history.replaceState({ kurs: first }, '', courseUrl(first));
    document.body.dataset.view = 'course';
    loadCourse(first, { push: false, animate: false });
  } else {
    setupPage();
  }
})();
