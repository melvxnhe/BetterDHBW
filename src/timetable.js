// The live side of a plan on screen: one week at a time, the module filter,
// and what is running right now. Without it every week is listed in full.
//
// setupTimetable() returns mount(root): it wires up the plan found in root
// (a course, or the preview on the homepage) and returns
// { update, filter, filterId, destroy }. app.js calls update() every minute.
function setupTimetable() {
  const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const clock = () => new Date();

  const fTime = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  const fWeekday = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, weekday: 'long' });
  const fDayLong = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
  const fKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const dayKey = (t) => fKey.format(t);
  const daysBetween = (a, b) => Math.round((Date.parse(dayKey(b)) - Date.parse(dayKey(a))) / 864e5);
  const fromTo = (a, b) => `${fTime.format(a)} – ${fTime.format(b)}`;

  const duration = (min) => {
    if (min < 60) return `${min} Min.`;
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h} Std. ${m} Min.` : `${h} Std.`;
  };
  // what is left of something running until `end`: never "0 Min."
  const remaining = (end, ms) => duration(Math.max(1, Math.round((end - ms) / 6e4)));

  // "in 40 Min.", "morgen um 08:45", "Donnerstag um 13:00", "in 12 Tagen"
  function until(t, now) {
    const min = Math.max(0, Math.round((t - now) / 6e4));
    const days = daysBetween(now, t);
    if (days === 0) return min < 1 ? 'jetzt' : `in ${duration(min)}`;
    if (days === 1) return `morgen um ${fTime.format(t)}`;
    if (days < 7) return `${fWeekday.format(t)} um ${fTime.format(t)}`;
    return `in ${days} Tagen`;
  }

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

  return function mount(root) {
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

    // Marks every session as past, running or next, and returns the running
    // ones (two groups at once are both live) and the next one.
    function updateSessions(t) {
      const ms = +t;
      const running = [];
      let next = null;
      for (const s of sessions) {
        const [a, b] = span(s);
        s.classList.toggle('is-past', b <= ms);
        s.classList.remove('is-live', 'is-next');
        if (a <= ms && ms < b) running.push(s);
        if (a > ms && !next) next = s;
      }
      running.forEach((s) => {
        const [a, b] = span(s);
        s.classList.add('is-live');
        s.querySelector('.session-status').textContent = `Läuft · noch ${remaining(b, ms)}`;
        setProgress(s.querySelector('.progress i'), (ms - a) / (b - a));
      });
      if (next) {
        next.classList.add('is-next');
        next.querySelector('.session-status').textContent = `Als Nächstes · ${until(+next.dataset.start, t)}`;
      }
      return { running, next };
    }

    // today's column, and which week tabs hold today or lie behind
    function updateCalendar(t) {
      const ms = +t, today = dayKey(t);
      days.forEach((d) => d.classList.toggle('is-today', d.dataset.date === today));
      tabs.forEach((tab, j) => {
        const [a, b] = span(panels[j]);
        tab.classList.toggle('has-today', a <= ms && ms < b);
        tab.classList.toggle('is-past', b <= ms);
      });
    }

    function examCountdown(a, b, t) {
      const ms = +t;
      if (b <= ms) return 'Vorbei';
      if (a <= ms) return 'Läuft gerade';
      const d = daysBetween(t, a);
      return d === 0 ? `Heute, ${until(a, t)}` : d === 1 ? 'Morgen' : `In ${d} Tagen`;
    }

    function updateExams(t) {
      exams.forEach((x) => {
        const [a, b] = span(x);
        x.classList.toggle('is-past', b <= +t);
        x.querySelector('.exam-countdown').textContent = examCountdown(a, b, t);
      });
    }

    // the card at the top: what is running, else what comes next
    function updateNow(running, next, t) {
      const live = running[0] || null;
      const pick = live || next;
      const label = now.querySelector('.now-label-text');
      const title = now.querySelector('.now-title');
      const meta = now.querySelector('.now-meta');
      const rel = now.querySelector('.now-rel');
      const progress = now.querySelector('.progress');
      now.classList.toggle('is-live', !!live);
      progress.hidden = !live;
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
        label.textContent = running.length > 1 ? `Läuft gerade · ${running.length} Termine parallel` : 'Läuft gerade';
        meta.textContent = [fromTo(a, b), room].filter(Boolean).join(' · ');
        rel.textContent = `Noch ${remaining(b, +t)}`;
        setProgress(progress.querySelector('i'), (+t - a) / (b - a));
      } else {
        label.textContent = 'Als Nächstes';
        meta.textContent = [fDayLong.format(a), fromTo(a, b), room].filter(Boolean).join(' · ');
        const r = until(a, t);
        rel.textContent = r.charAt(0).toUpperCase() + r.slice(1);
      }
    }

    function update() {
      const t = clock();
      const { running, next } = updateSessions(t);
      updateCalendar(t);
      updateExams(t);
      if (now) updateNow(running, next, t);
      // a new week began while the page was open: show it (instantly, nobody asked for motion)
      if (follow && active >= 0) select(currentWeek(+t), { remember: false });
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
  };
}
