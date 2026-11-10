// The course search (an ARIA combobox): one in the header, one on the homepage.
//
// setupSearch({ courses, byName, recent, current, open }) returns
// combobox(input, list, go), which turns an <input> and a <ul> into a search:
// - courses, byName: every course, as a list and by name
// - recent(): the names opened last, newest first
// - current(): the course on screen, or null
// - open(name, { animate }): called with the course picked
function setupSearch({ courses, byName, recent, current, open }) {
  const MAX_RESULTS = 60;
  const squash = (s) => s.toUpperCase().replace(/[^A-Z0-9ÄÖÜ]/g, '');
  const yearOf = (name) => +(name.match(/\d{2}/) || [0])[0];

  // What the list shows for a query: courses, with { group } headings and { note } lines between them.
  function results(query) {
    const q = squash(query);
    if (!q) {
      // nothing typed yet: the courses opened last, then the open course's siblings
      const last = recent().map((n) => byName.get(n));
      const stem = ((current() || '').match(/^[A-Z]+\d{2}/) || [''])[0];
      const siblings = stem ? courses.filter((c) => c.name.startsWith(stem) && !last.includes(c)) : [];
      return [
        ...(last.length ? [{ group: 'Zuletzt geöffnet' }, ...last] : []),
        ...(siblings.length ? [{ group: `Kurse wie ${current()}` }, ...siblings] : []),
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
    const shown = hits.slice(0, MAX_RESULTS).map((h) => h.c);
    return hits.length > MAX_RESULTS ? [...shown, { note: `${hits.length - MAX_RESULTS} weitere, genauer suchen` }] : shown;
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

  return function combobox(input, list, go) {
    const prefix = list.id;
    let options = [];
    let active = -1;

    function itemHTML(x) {
      if (x.group) return `<li class="search-group" role="presentation">${esc(x.group)}</li>`;
      if (x.note) return `<li class="search-note" role="presentation">${esc(x.note)}</li>`;
      return `<li class="search-option" role="option" id="${prefix}-${esc(x.name)}" data-name="${esc(x.name)}"${x.full ? ` title="${esc(x.full)}"` : ''} aria-selected="false">
<span class="option-name">${mark(x.name, input.value)}</span><span class="option-meta">${esc(x.track || x.degree || x.meta)}${x.name === current() ? ' · geöffnet' : ''}</span></li>`;
    }

    function render() {
      const typed = input.value.trim();
      const items = results(input.value);
      options = items.filter((x) => x.name);
      list.innerHTML = items.length
        ? items.map(itemHTML).join('')
        : `<li class="search-note" role="presentation">${typed ? `Kein Kurs passt zu „${esc(typed)}“.` : `${courses.length} Kurse der DHBW Mannheim. Kürzel oder Studiengang tippen, z. B. WWI26 oder Software Engineering.`}</li>`;
      setActive(typed && options.length ? 0 : -1);
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
    function show() {
      render();
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }

    function hide() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      active = -1;
    }

    function choose(i, { keyboard }) {
      const c = options[i];
      if (!c) return;
      hide();
      input.value = '';
      input.blur();
      if (c.name !== current()) open(c.name, { animate: !keyboard });
    }

    // the option under a pointer event, as an index into `options`
    const optionAt = (e) => {
      const el = e.target.closest('[role="option"]');
      return el ? options.findIndex((c) => c.name === el.dataset.name) : -1;
    };

    input.addEventListener('focus', show);
    input.addEventListener('input', show);
    input.addEventListener('blur', hide);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (list.hidden) show();
        if (!options.length) return;
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setActive(active < 0 ? (step > 0 ? 0 : options.length - 1) : (active + step + options.length) % options.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        choose(active >= 0 ? active : 0, { keyboard: true });
      } else if (e.key === 'Escape') {
        if (!list.hidden && input.value) { input.value = ''; render(); } else { hide(); input.blur(); }
      }
    });
    // pointerdown keeps focus in the field, so the list doesn't close before the click lands
    list.addEventListener('pointerdown', (e) => e.preventDefault());
    list.addEventListener('click', (e) => {
      const i = optionAt(e);
      if (i >= 0) choose(i, { keyboard: false });
    });
    list.addEventListener('pointermove', (e) => {
      const i = optionAt(e);
      if (i >= 0 && i !== active) setActive(i);
    });
    // the button opens the best match, or puts the cursor in the field
    go?.addEventListener('pointerdown', (e) => { if (input.value.trim()) e.preventDefault(); });
    go?.addEventListener('click', (e) => {
      if (!input.value.trim()) { input.focus(); return; }
      if (list.hidden) render();
      choose(active >= 0 ? active : 0, { keyboard: e.detail === 0 });
    });
  };
}
