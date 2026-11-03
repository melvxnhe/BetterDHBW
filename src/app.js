// Enhances the server-rendered timetable: one week at a time, a module filter,
// and the live "now" state. Without this script every week is listed in full.
(() => {
  const TZ = 'Europe/Berlin';
  const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const clock = () => new Date();

  const fTime = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  const fWeekday = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, weekday: 'long' });
  const fDayLong = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
  const fKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const dayKey = (t) => fKey.format(t);
  const daysBetween = (a, b) => Math.round((Date.parse(dayKey(b)) - Date.parse(dayKey(a))) / 864e5);

  const duration = (min) => {
    if (min < 60) return `${min} Min.`;
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h} Std. ${m} Min.` : `${h} Std.`;
  };

  // "in 40 Min.", "morgen um 08:45", "Donnerstag um 13:00", "in 12 Tagen"
  function until(t, now) {
    const min = Math.max(0, Math.round((t - now) / 6e4));
    const days = daysBetween(now, t);
    if (days === 0) return min < 1 ? 'jetzt' : `in ${duration(min)}`;
    if (days === 1) return `morgen um ${fTime.format(t)}`;
    if (days < 7) return `${fWeekday.format(t)} um ${fTime.format(t)}`;
    return `in ${days} Tagen`;
  }

  let view = null;

  // Progress bars glide linearly from one minute to the next, but their first
  // value appears as is: a sweep from empty on every load or redraw would be
  // motion nobody asked for, and would suggest the lecture just started.
  function setProgress(bar, share) {
    const value = `scaleX(${Math.min(1, Math.max(0, share)).toFixed(4)})`;
    if (bar.dataset.ready) { bar.style.transform = value; return; }
    bar.style.transition = 'none';
    bar.style.transform = value;
    bar.getBoundingClientRect(); // commit the value before the transition returns
    bar.style.transition = '';
    bar.dataset.ready = '1';
  }

  function mount(root) {
    const main = root.querySelector('main');
    const bar = root.querySelector('.bar');
    const sessions = [...main.querySelectorAll('.session')];
    const days = [...main.querySelectorAll('.day')];
    const exams = [...main.querySelectorAll('.exam')];
    const chips = [...main.querySelectorAll('.chip')];
    const tabs = [...main.querySelectorAll('.tabs [role="tab"]')];
    const copy = main.querySelector('.tabs-active');
    const scroller = main.querySelector('.tabs-scroll');
    const panels = tabs.map((t) => main.querySelector('#' + t.getAttribute('aria-controls')));
    const now = main.querySelector('.now');
    const span = (el) => [+el.dataset.start, +el.dataset.end];
    // the week of today, else the next one, else the last
    const currentWeek = (ms) => { const i = panels.findIndex((p) => ms < span(p)[1]); return i < 0 ? panels.length - 1 : i; };
    let active = -1;
    let shownFilter = 'all';
    // The open week follows the calendar (Monday morning shows the new week)
    // until the person picks a week themselves; from then on it stays put.
    let follow = true;

    // ---- week tabs ----

    function placeClip(animate) {
      if (!copy || active < 0) return;
      const t = tabs[active];
      const right = copy.offsetWidth - (t.offsetLeft + t.offsetWidth);
      copy.classList.toggle('is-moving', animate && !reduceMotion.matches);
      copy.style.clipPath = `inset(0 ${right}px 0 ${t.offsetLeft}px round 10px)`;
    }

    function revealTab(i, animate) {
      if (!scroller) return;
      const t = tabs[i];
      const left = t.offsetLeft - 16, right = t.offsetLeft + t.offsetWidth + 16;
      const view = scroller.scrollLeft, w = scroller.clientWidth;
      if (left < view || right > view + w) {
        scroller.scrollTo({ left: left - (w - t.offsetWidth) / 2 + 16, behavior: animate && !reduceMotion.matches ? 'smooth' : 'instant' });
      }
    }

    function select(i, { animate = false, focus = false, remember = true } = {}) {
      if (i === active || i < 0 || i >= tabs.length) return;
      const from = active;
      active = i;
      tabs.forEach((t, j) => {
        t.setAttribute('aria-selected', String(j === i));
        t.tabIndex = j === i ? 0 : -1;
        panels[j].hidden = j !== i;
      });
      placeClip(animate);
      revealTab(i, animate);
      if (focus) tabs[i].focus({ preventScroll: true });
      if (animate && from >= 0) {
        // Enter from the side we are moving towards; exit is instant (faster than enter).
        const dx = reduceMotion.matches ? 0 : (i > from ? 12 : -12);
        panels[i].animate(
          [{ opacity: 0, transform: `translateX(${dx}px)` }, { opacity: 1, transform: 'none' }],
          { duration: reduceMotion.matches ? 150 : 200, easing: reduceMotion.matches ? 'ease' : EASE_OUT }
        );
      }
      if (from >= 0 && remember) history.replaceState(null, '', '#' + panels[i].id);
    }

    tabs.forEach((t, i) => t.addEventListener('click', (e) => {
      e.preventDefault();
      follow = false;
      // detail is 0 for Enter/Space: keyboard actions never animate
      select(i, { animate: e.detail !== 0 });
    }));

    main.querySelector('.tabs')?.addEventListener('keydown', (e) => {
      const keys = { ArrowRight: active + 1, ArrowLeft: active - 1, Home: 0, End: tabs.length - 1 };
      if (!(e.key in keys)) return;
      e.preventDefault();
      follow = false;
      select(Math.max(0, Math.min(tabs.length - 1, keys[e.key])), { focus: true });
    });

    const resize = new ResizeObserver(() => placeClip(false));
    if (copy) resize.observe(copy);

    // ---- module filter ----

    function filter(id) {
      if (id !== 'all' && !chips.some((c) => c.dataset.filter === id)) id = 'all';
      shownFilter = id;
      chips.forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.filter === id)));
      sessions.forEach((s) => s.classList.toggle('is-dimmed', id !== 'all' && s.dataset.module !== id));
      panels.forEach((p, j) => tabs[j].classList.toggle('is-empty',
        id !== 'all' && !p.querySelector(`.session[data-module="${id}"]`)));
    }

    chips.forEach((c) => c.addEventListener('click', () => {
      const pressed = c.getAttribute('aria-pressed') === 'true';
      filter(pressed && c.dataset.filter !== 'all' ? 'all' : c.dataset.filter);
    }));

    // ---- header divider once content runs under it ----

    let scrolled = null;
    if (bar) {
      let sentinel = document.getElementById('top-sentinel');
      if (!sentinel) {
        sentinel = document.createElement('div');
        sentinel.id = 'top-sentinel';
        sentinel.style.cssText = 'position:absolute;top:0;left:0;height:1px;width:1px';
        document.body.prepend(sentinel);
      }
      scrolled = new IntersectionObserver(([e]) => bar.classList.toggle('is-scrolled', !e.isIntersecting));
      scrolled.observe(sentinel);
    }

    // ---- now ----

    function update() {
      const t = clock();
      const ms = +t;
      const today = dayKey(t);

      // parallel sessions (two groups at once) are all live
      const running = [];
      let next = null;
      for (const s of sessions) {
        const [a, b] = span(s);
        s.classList.toggle('is-past', b <= ms);
        s.classList.remove('is-live', 'is-next');
        if (a <= ms && ms < b) running.push(s);
        if (a > ms && !next) next = s;
      }
      const live = running[0] || null;

      running.forEach((s) => {
        const [a, b] = span(s);
        s.classList.add('is-live');
        s.querySelector('.session-status').textContent = `Läuft · noch ${duration(Math.max(1, Math.round((b - ms) / 6e4)))}`;
        setProgress(s.querySelector('.progress i'), (ms - a) / (b - a));
      });
      if (next) {
        next.classList.add('is-next');
        next.querySelector('.session-status').textContent = `Als Nächstes · ${until(+next.dataset.start, t)}`;
      }

      days.forEach((d) => d.classList.toggle('is-today', d.dataset.date === today));
      tabs.forEach((tab, j) => {
        const [a, b] = span(panels[j]);
        tab.classList.toggle('has-today', a <= ms && ms < b);
        tab.classList.toggle('is-past', b <= ms);
      });

      exams.forEach((x) => {
        const [a, b] = span(x);
        const out = x.querySelector('.exam-countdown');
        x.classList.toggle('is-past', b <= ms);
        out.textContent = b <= ms ? 'Vorbei' : a <= ms ? 'Läuft gerade' : (() => {
          const d = daysBetween(t, a);
          return d === 0 ? `Heute, ${until(a, t)}` : d === 1 ? 'Morgen' : `In ${d} Tagen`;
        })();
      });

      if (now) renderNow(live, next, t, running.length - 1);

      // a new week began while the page was open: show it (instantly, nobody asked for motion)
      if (follow && active >= 0) select(currentWeek(ms), { remember: false });
    }

    function renderNow(live, next, t, parallel = 0) {
      const pick = live || next;
      const label = now.querySelector('.now-label-text');
      const title = now.querySelector('.now-title');
      const meta = now.querySelector('.now-meta');
      const rel = now.querySelector('.now-rel');
      const bar = now.querySelector('.progress');
      now.classList.toggle('is-live', !!live);
      bar.hidden = !live;
      if (!pick) {
        label.textContent = sessions.length ? 'Theoriephase vorbei' : 'Keine Termine';
        title.textContent = sessions.length ? 'Alle Termine dieses Blocks sind vorbei.' : 'In Rapla sind für diesen Kurs keine kommenden Termine eingetragen.';
        meta.textContent = '';
        rel.textContent = '';
        return;
      }
      const [a, b] = span(pick);
      const room = pick.dataset.room;
      title.textContent = pick.querySelector('.session-title').textContent;
      if (live) {
        label.textContent = parallel > 0 ? `Läuft gerade · ${parallel + 1} Termine parallel` : 'Läuft gerade';
        meta.textContent = [`${fTime.format(a)} – ${fTime.format(b)}`, room].filter(Boolean).join(' · ');
        rel.textContent = `Noch ${duration(Math.max(1, Math.round((b - +t) / 6e4)))}`;
        setProgress(bar.querySelector('i'), (+t - a) / (b - a));
      } else {
        label.textContent = 'Als Nächstes';
        meta.textContent = [fDayLong.format(a), `${fTime.format(a)} – ${fTime.format(b)}`, room].filter(Boolean).join(' · ');
        const r = until(a, t);
        rel.textContent = r.charAt(0).toUpperCase() + r.slice(1);
      }
    }

    // ---- start: the week from the URL, else the one holding today, else the next one ----

    update();
    const fromHash = panels.findIndex((p) => '#' + p.id === location.hash);
    follow = fromHash < 0;
    select(fromHash >= 0 ? fromHash : currentWeek(+clock()));
    filter('all');

    return {
      update,
      filter,
      get filterId() { return shownFilter; },
      destroy() { resize.disconnect(); scrolled?.disconnect(); },
    };
  }

  function start(root = document) {
    view?.destroy();
    document.documentElement.classList.replace('no-js', 'js');
    view = mount(root);
  }

  // One clock for the page: on every full minute, and whenever the page comes
  // back (tab shown again, phone unlocked, laptop woken, restored from the
  // back/forward cache, network back). Timers in background tabs are throttled
  // or frozen, so the minute tick alone would leave a stale page behind.
  const syncs = []; // extra work per tick: the homepage preview, fresh Rapla data
  function sync() {
    syncs.forEach((fn) => fn());
    view?.update();
  }

  function tick() {
    sync();
    setTimeout(tick, 60000 - (Date.now() % 60000) + 50);
  }

  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  addEventListener('pageshow', (e) => { if (e.persisted) sync(); });
  addEventListener('online', sync);
  window.__timetable = { start, update: sync };
  start();
  setTimeout(tick, 60000 - (Date.now() % 60000) + 50);

  // ---------- every Mannheim course: a homepage, a search, courses loaded in place ----------

  const catalog = JSON.parse(document.getElementById('course-data')?.textContent || '{"courses":[]}');
  const courses = catalog.courses;
  const byName = new Map(courses.map((c) => [c.name, c]));
  const isDev = !!document.querySelector('template[data-fixture]');
  // the homepage as shipped; coming back to it later skips the first-load entrance
  const home = { main: document.querySelector('main').innerHTML.replace('class="home" data-enter', 'class="home"'), foot: document.querySelector('.foot').innerHTML, title: document.title };
  let current = null; // null while the homepage shows
  let icsUrl = null;

  const RECENT = 'dhbw-ma-zuletzt';
  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
  const recent = () => read(RECENT, []).filter((n) => byName.has(n));

  const bar = document.querySelector('.bar');
  let loadToken = 0;

  class LoadError extends Error {}

  async function fetchEvents(course) {
    let events = [];
    for (const id of course.ids) {
      let res;
      try {
        res = await fetch(`api/rapla/lectures/${encodeURIComponent(id)}/events`, { headers: { Accept: 'application/json' } });
      } catch {
        throw new LoadError('server');
      }
      // serve.mjs marks its answers; anything else is a plain static server
      if (!res.headers.has('x-dhbw-proxy')) throw new LoadError('server');
      if (!res.ok) throw new LoadError('upstream');
      events = normalize(await res.json());
      if (events.length) break; // the older Rapla id may be empty; try the next
    }
    return events;
  }

  function setIcs(name, events) {
    if (icsUrl) URL.revokeObjectURL(icsUrl);
    icsUrl = URL.createObjectURL(new Blob([icsFor(name, events)], { type: 'text/calendar' }));
    document.querySelectorAll('[data-ics]').forEach((a) => {
      a.href = icsUrl;
      a.download = `${name.toLowerCase()}.ics`;
    });
  }

  // Swap the page. Choices made by pointer fade in so content doesn't
  // teleport; keyboard choices and history steps stay instant.
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
    loadToken++;
    bar.classList.remove('is-loading');
    swap({ view: 'home', name: null, main: home.main, foot: home.foot, title: home.title, animate });
    if (push) history.pushState({}, '', location.pathname);
  }

  function showError(name, kind, retry) {
    const msg = kind === 'server'
      ? 'Kurse lassen sich nur laden, wenn die Seite über <b>start.cmd</b> (oder <code>npm start</code>) läuft. api.dhbw.app erlaubt keine Abrufe direkt aus dem Browser, der lokale Server reicht sie weiter.'
      : 'api.dhbw.app hat gerade nicht geantwortet. Später noch einmal versuchen.';
    swap({ view: 'course', name, title: `${name} Stundenplan`, foot: null, animate: false, main: `<div class="wrap"><section class="intro" aria-labelledby="page-title"><div>
<h1 class="title" id="page-title">${esc(name)}</h1>
<p class="subtitle">Der Stundenplan konnte nicht geladen werden.</p></div></section>
<div class="empty-state error-state" role="alert"><p>${msg}</p>
<p class="error-actions"><button class="button" type="button" data-retry>Erneut versuchen</button>
<a href="./" data-home>Zur Startseite</a></p></div></div>` });
    document.querySelector('[data-retry]').addEventListener('click', retry);
  }

  async function loadCourse(name, { push = true, animate = true } = {}) {
    const course = byName.get(name);
    if (!course) return false;
    const token = ++loadToken;
    const main = document.querySelector('main');
    main.setAttribute('aria-busy', 'true');
    main.classList.add('is-loading');
    bar.classList.add('is-loading');
    const url = `?kurs=${encodeURIComponent(course.name)}`;
    try {
      const events = await fetchEvents(course);
      if (token !== loadToken) return false;
      const now = Date.now();
      // the address changes first, so the new plan doesn't pick up the old course's week anchor
      if (push) history.pushState({ kurs: course.name }, '', url);
      swap({ view: 'course', name: course.name, title: `${course.name} Stundenplan`, animate,
        main: mainHTML(events, { course: course.name, full: course.full, now }), foot: footerHTML(events, { course: course.name, fetchedAt: now }) });
      setIcs(course.name, events);
      shown = { name: course.name, sig: JSON.stringify(events), at: now };
      write(RECENT, [course.name, ...recent().filter((n) => n !== course.name)].slice(0, 5));
      return true;
    } catch (err) {
      if (token !== loadToken) return false;
      if (push) history.pushState({ kurs: course.name }, '', url);
      showError(course.name, err instanceof LoadError ? err.message : 'upstream', () => loadCourse(course.name, { push: false }));
      return false;
    } finally {
      if (token === loadToken) {
        const m = document.querySelector('main');
        m.removeAttribute('aria-busy');
        m.classList.remove('is-loading');
        bar.classList.remove('is-loading');
      }
    }
  }

  // ---- staying in sync with Rapla while the page stays open ----

  const REFRESH = 10 * 60 * 1000;
  let shown = null; // { name, sig, at }: the course on screen and what Rapla said last
  let refreshing = false;

  // Every ten minutes (checked on each tick, and when the tab comes back) the
  // open course is fetched again. Only a real change redraws the plan, in
  // place: same week, same filter, same scroll position, and without motion,
  // because nobody asked for it.
  async function refreshCourse() {
    const mine = shown;
    if (!mine || refreshing || document.hidden || Date.now() - mine.at < REFRESH) return;
    refreshing = true;
    const token = loadToken;
    try {
      const events = await fetchEvents(byName.get(mine.name));
      if (token !== loadToken || shown !== mine) return;
      const now = Date.now();
      mine.at = now;
      document.querySelector('.foot').innerHTML = footerHTML(events, { course: mine.name, fetchedAt: now });
      setIcs(mine.name, events);
      const sig = JSON.stringify(events);
      if (sig === mine.sig) return;
      mine.sig = sig;
      const keep = view?.filterId || 'all', y = scrollY;
      document.querySelector('main').innerHTML = mainHTML(events, { course: mine.name, full: byName.get(mine.name).full, now });
      start();
      view.filter(keep);
      scrollTo({ top: y, behavior: 'instant' });
    } catch {
      mine.at = Date.now() - REFRESH + 60000; // offline or API down: try again in a minute
    } finally {
      refreshing = false;
    }
  }

  // The homepage preview is drawn in the browser from the course's data, so it
  // always shows the next day with lectures, not the day the site was built.
  // The data shipped with the page is refreshed from Rapla right away.
  const sample = { name: catalog.sample?.name || null, events: normalize(catalog.sample?.raw || []), key: null, at: 0 };

  function renderPreview(force = false) {
    const stage = document.querySelector('.hero-stage');
    if (current !== null || !stage || !sample.name) return;
    const now = Date.now();
    const { block } = splitBlock(sample.events, now);
    const next = block.find((e) => e.end > now) || block.at(-1);
    const key = next ? keyOf(partsOf(next.start)) : '';
    if (!force && key === sample.key) return;
    const html = previewHTML(sample.name, sample.events, now);
    if (!html) return;
    sample.key = key;
    stage.innerHTML = html;
    start();
  }

  async function refreshSample() {
    const course = byName.get(sample.name);
    if (current !== null || !course || document.hidden || Date.now() - sample.at < REFRESH) return;
    sample.at = Date.now();
    try {
      const events = await fetchEvents(course);
      if (JSON.stringify(events) === JSON.stringify(sample.events)) return;
      sample.events = events;
      renderPreview(true);
    } catch {
      sample.at = Date.now() - REFRESH + 60000;
    }
  }

  syncs.push(() => { refreshCourse(); renderPreview(); refreshSample(); });

  document.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button > 0) return;
    const link = e.target.closest('[data-course-link], [data-home]');
    if (!link) return;
    e.preventDefault();
    if (link.hasAttribute('data-home')) {
      if (current !== null) showHome({ animate: e.detail !== 0 });
      else window.scrollTo({ top: 0, behavior: reduceMotion.matches ? 'instant' : 'smooth' });
    } else {
      loadCourse(link.dataset.courseLink, { animate: e.detail !== 0 });
    }
  });

  addEventListener('popstate', () => {
    const name = (new URLSearchParams(location.search).get('kurs') || '').toUpperCase();
    if (byName.has(name)) { if (name !== current) loadCourse(name, { push: false, animate: false }); }
    else if (current !== null) showHome({ push: false });
  });

  // ---- the search boxes (ARIA combobox): one in the header, one on the homepage ----

  const squash = (s) => s.toUpperCase().replace(/[^A-Z0-9ÄÖÜ]/g, '');
  const yearOf = (name) => +(name.match(/\d{2}/) || [0])[0];

  function results(query) {
    const q = squash(query);
    if (!q) {
      // nothing typed yet: the courses opened last, then the open course's siblings
      const last = recent().map((n) => byName.get(n));
      const stem = ((current || '').match(/^[A-Z]+\d{2}/) || [''])[0];
      const siblings = stem ? courses.filter((c) => c.name.startsWith(stem) && !last.includes(c)) : [];
      return [
        ...(last.length ? [{ group: 'Zuletzt geöffnet' }, ...last] : []),
        ...(siblings.length ? [{ group: `Kurse wie ${current}` }, ...siblings] : []),
      ];
    }
    // the code first ("WWI26SE"), then words of the full name ("Software Engineering")
    const hits = [];
    for (const c of courses) {
      const at = squash(c.name).indexOf(q);
      if (at >= 0) hits.push({ c, score: squash(c.name) === q ? 0 : at === 0 ? 1 : 2 });
      else if (q.length >= 3 && squash(c.full || '').includes(q)) hits.push({ c, score: 3 });
    }
    hits.sort((a, b) => a.score - b.score || yearOf(b.c.name) - yearOf(a.c.name) || a.c.name.localeCompare(b.c.name, 'de'));
    const shown = hits.slice(0, 60).map((h) => h.c);
    return hits.length > 60 ? [...shown, { note: `${hits.length - 60} weitere, genauer suchen` }] : shown;
  }

  // bold the part of the name that matches what was typed
  function mark(name, query) {
    const q = squash(query);
    if (!q) return esc(name);
    const map = [];
    let flat = '';
    [...name].forEach((ch, i) => { const s = squash(ch); if (s) { flat += s; map.push(i); } });
    const at = flat.indexOf(q);
    if (at < 0) return esc(name);
    const a = map[at], b = map[at + q.length - 1] + 1;
    return `${esc(name.slice(0, a))}<b>${esc(name.slice(a, b))}</b>${esc(name.slice(b))}`;
  }

  function combobox(input, list, go) {
    const prefix = list.id;
    let options = [];
    let active = -1;

    function render() {
      const items = results(input.value);
      options = items.filter((x) => x.name);
      list.innerHTML = items.length
        ? items.map((x) => {
          if (x.group) return `<li class="search-group" role="presentation">${esc(x.group)}</li>`;
          if (x.note) return `<li class="search-note" role="presentation">${esc(x.note)}</li>`;
          return `<li class="search-option" role="option" id="${prefix}-${esc(x.name)}" data-name="${esc(x.name)}"${x.full ? ` title="${esc(x.full)}"` : ''} aria-selected="false">
<span class="option-name">${mark(x.name, input.value)}</span><span class="option-meta">${esc(x.track || x.degree || x.meta)}${x.name === current ? ' · geöffnet' : ''}</span></li>`;
        }).join('')
        : `<li class="search-note" role="presentation">${input.value.trim() ? `Kein Kurs passt zu „${esc(input.value.trim())}“.` : `${courses.length} Kurse der DHBW Mannheim. Kürzel oder Studiengang tippen, z. B. WWI26 oder Software Engineering.`}</li>`;
      setActive(input.value.trim() && options.length ? 0 : -1);
    }

    function setActive(i) {
      active = i;
      const els = list.querySelectorAll('[role="option"]');
      els.forEach((el, j) => el.setAttribute('aria-selected', String(j === i)));
      if (els[i]) {
        input.setAttribute('aria-activedescendant', els[i].id);
        els[i].scrollIntoView({ block: 'nearest' });
      } else {
        input.removeAttribute('aria-activedescendant');
      }
    }

    // Opens instantly: the list follows typing and the keyboard, so it never animates.
    function open() {
      render();
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }

    function close() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      active = -1;
    }

    function choose(i, { keyboard }) {
      const c = options[i];
      if (!c) return;
      close();
      input.value = '';
      input.blur();
      if (c.name !== current) loadCourse(c.name, { animate: !keyboard });
    }

    input.addEventListener('focus', open);
    input.addEventListener('input', open);
    input.addEventListener('blur', close);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (list.hidden) open();
        if (!options.length) return;
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setActive(active < 0 ? (step > 0 ? 0 : options.length - 1) : (active + step + options.length) % options.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        choose(active >= 0 ? active : 0, { keyboard: true });
      } else if (e.key === 'Escape') {
        if (!list.hidden && input.value) { input.value = ''; render(); } else { close(); input.blur(); }
      }
    });
    // pointerdown keeps focus in the field, so the list doesn't close before the click lands
    list.addEventListener('pointerdown', (e) => e.preventDefault());
    list.addEventListener('click', (e) => {
      const el = e.target.closest('[role="option"]');
      if (el) choose(options.findIndex((c) => c.name === el.dataset.name), { keyboard: false });
    });
    list.addEventListener('pointermove', (e) => {
      const el = e.target.closest('[role="option"]');
      if (!el) return;
      const i = options.findIndex((c) => c.name === el.dataset.name);
      if (i !== active) setActive(i);
    });
    // the button opens the best match, or puts the cursor in the field
    go?.addEventListener('pointerdown', (e) => { if (input.value.trim()) e.preventDefault(); });
    go?.addEventListener('click', (e) => {
      if (!input.value.trim()) { input.focus(); return; }
      if (list.hidden) render();
      choose(active >= 0 ? active : 0, { keyboard: e.detail === 0 });
    });
  }

  const headerInput = document.getElementById('course-search');
  if (headerInput) combobox(headerInput, document.getElementById('course-list'));

  // "/" focuses a search from anywhere: the big one on the homepage, else the header's
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    e.preventDefault();
    (document.getElementById('hero-search') || headerInput)?.focus();
  });

  // ---- what the homepage adds: its own search, recent courses, reveals ----

  let pageObservers = [];

  function setupPage() {
    pageObservers.forEach((o) => o.disconnect());
    pageObservers = [];
    bar.classList.remove('show-search');

    const heroInput = document.getElementById('hero-search');
    if (!heroInput) return;
    combobox(heroInput, document.getElementById('hero-list'), document.querySelector('[data-search-go]'));

    // the preview as of now, then fresh data from Rapla
    renderPreview(true);
    refreshSample();

    const slot = document.querySelector('[data-recent]');
    const last = recent().slice(0, 3);
    if (slot && last.length) {
      slot.innerHTML = `Zuletzt: ${last.map((n) => `<a href="?kurs=${encodeURIComponent(n)}" data-course-link="${esc(n)}">${esc(n)}</a>`).join(' ')}`;
      slot.hidden = false;
    }

    // the header's search appears once the big one has scrolled away
    const heroSearch = heroInput.closest('.search');
    const watch = new IntersectionObserver(([e]) => bar.classList.toggle('show-search', !e.isIntersecting && e.boundingClientRect.top < 0));
    watch.observe(heroSearch);
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

  // ---- first view: a course from the address, else the homepage ----

  if (!isDev) {
    const wanted = (new URLSearchParams(location.search).get('kurs') || '').toUpperCase();
    if (byName.has(wanted)) {
      document.body.dataset.view = 'course';
      loadCourse(wanted, { push: false, animate: false });
    } else {
      setupPage();
    }
  }
})();
