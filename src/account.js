// Accounts in the page: sign-in, sign-up with a DHBW Mannheim address,
// password reset, the account page, the course synced across devices and a
// private note per lecture. The server side is api/_account.js; the session
// is an HttpOnly cookie this script never sees. Views live at ?konto=<view>.
//
// Called once by app.js with what it needs from the page; returns the hooks
// app.js calls back (route, courseShown, decorate).
function setupAccounts(app) {
  const state = { available: false, user: null, settings: null, notes: new Map(), notesCourse: null, returnTo: null };

  async function api(action, { method = 'GET', body = null, query = null } = {}) {
    const url = `api/account/${action}${query ? `?${new URLSearchParams(query)}` : ''}`;
    try {
      const res = await fetch(url, {
        method, credentials: 'same-origin', cache: 'no-store',
        headers: body ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      let data = {};
      try { data = await res.json(); } catch { /* empty answer */ }
      return { ok: res.ok, status: res.status, data };
    } catch {
      return { ok: false, status: 0, data: { message: 'Keine Verbindung. Bitte später noch einmal versuchen.' } };
    }
  }

  // ---------- header ----------

  function renderHeader() {
    document.querySelectorAll('[data-account-link]').forEach((a) => {
      a.hidden = !state.available;
      a.querySelector('[data-account-label]').textContent = state.user ? 'Konto' : 'Anmelden';
      a.setAttribute('aria-label', state.user ? `Konto (${state.user.email})` : 'Anmelden');
    });
  }

  // ---------- signed in / out ----------

  function signedIn(data) {
    state.user = data.user;
    state.settings = data.settings || {};
    // courses opened elsewhere come first in "recently opened" here too
    const merged = [...(state.settings.recent || []), ...app.recent()].filter((n, i, all) => all.indexOf(n) === i && app.byName.has(n)).slice(0, 5);
    app.setRecent(merged);
    renderHeader();
  }

  function signedOut() {
    state.user = null;
    state.settings = null;
    state.notes.clear();
    state.notesCourse = null;
    renderHeader();
    decorate();
  }

  let saveTimer = null;
  function courseOpened(name) {
    if (!state.user) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      api('settings', { method: 'PUT', body: { settings: { course: name, recent: app.recent() } } }).then((r) => { if (r.ok) state.settings = r.data.settings; });
    }, 800);
  }

  // ---------- views ----------

  const field = (name, label, { type = 'text', autocomplete = 'off', hint = '', extra = '' } = {}) => {
    const id = `f-${name}`;
    const input = `<input id="${id}" name="${name}" type="${type}" autocomplete="${autocomplete}" ${extra} required${hint ? ` aria-describedby="${id}-hint"` : ''}>`;
    return `<div class="field"><label class="field-label" for="${id}">${label}</label>${type === 'password'
      ? `<div class="password-wrap">${input}<button class="reveal" type="button" data-reveal-password aria-controls="${id}" aria-pressed="false">Anzeigen</button></div>`
      : input}${hint ? `<p class="field-hint" id="${id}-hint">${hint}</p>` : ''}</div>`;
  };
  const EMAIL = (autocomplete = 'username') => field('email', 'E-Mail-Adresse der DHBW', { type: 'email', autocomplete, extra: 'inputmode="email" autocapitalize="none" spellcheck="false" maxlength="254"' });
  const PASSWORD_HINT = 'Mindestens 10 Zeichen. Passwörter aus bekannten Datenlecks werden abgelehnt.';
  const message = '<p class="form-message" data-message role="alert" hidden></p>';
  const card = (title, lead, body) => `<div class="wrap account"><section class="account-card" aria-labelledby="account-title">
<h1 class="account-title" id="account-title">${title}</h1>${lead ? `<p class="account-lead">${lead}</p>` : ''}
${body}</section></div>`;
  const link = (view, label) => `<a href="?konto=${view}" data-account-view="${view}">${label}</a>`;

  const VIEWS = {
    anmelden: {
      title: 'Anmelden',
      html: () => card('Anmelden', 'Mit deiner DHBW-Adresse sind dein Kurs und deine Notizen auf jedem Gerät da.', `
<form class="account-form" data-form="login" novalidate>${EMAIL()}${field('password', 'Passwort', { type: 'password', autocomplete: 'current-password', extra: 'maxlength="200"' })}${message}
<button class="button button-wide" type="submit">Anmelden</button></form>
<p class="account-links">${link('vergessen', 'Passwort vergessen?')}<span>Noch kein Konto? ${link('registrieren', 'Registrieren')}</span></p>`),
    },
    registrieren: {
      title: 'Registrieren',
      html: () => card('Konto anlegen', 'Nur mit einer Adresse der DHBW Mannheim (…@student.dhbw-mannheim.de oder …@dhbw-mannheim.de). Du bekommst eine E-Mail zum Bestätigen.', `
<form class="account-form" data-form="register" novalidate>${EMAIL('email')}${field('password', 'Passwort', { type: 'password', autocomplete: 'new-password', hint: PASSWORD_HINT, extra: 'minlength="10" maxlength="200"' })}${message}
<button class="button button-wide" type="submit">Konto anlegen</button></form>
<p class="account-links"><span>Schon ein Konto? ${link('anmelden', 'Anmelden')}</span></p>`),
    },
    vergessen: {
      title: 'Passwort vergessen',
      html: () => card('Passwort vergessen', 'Wir schicken dir einen Link, mit dem du ein neues Passwort setzt.', `
<form class="account-form" data-form="forgot" novalidate>${EMAIL()}${message}
<button class="button button-wide" type="submit">Link schicken</button></form>
<p class="account-links">${link('anmelden', 'Zurück zum Anmelden')}</p>`),
    },
    passwort: {
      title: 'Neues Passwort',
      html: () => card('Neues Passwort', 'Danach bist du angemeldet und auf allen anderen Geräten abgemeldet.', `
<form class="account-form" data-form="reset" novalidate>${field('password', 'Neues Passwort', { type: 'password', autocomplete: 'new-password', hint: PASSWORD_HINT, extra: 'minlength="10" maxlength="200"' })}${message}
<button class="button button-wide" type="submit">Passwort speichern</button></form>`),
    },
    bestaetigen: {
      title: 'Konto bestätigen',
      html: () => card('Konto bestätigen', '', `<p class="account-lead" data-verify-status role="status">Einen Moment, dein Konto wird bestätigt …</p>`),
    },
    konto: {
      title: 'Konto',
      html: () => card('Dein Konto', esc(state.user.email), `
<p class="form-message is-ok" data-flash role="status" hidden></p>
<section class="account-section" aria-labelledby="sync-title"><h2 id="sync-title">Auf allen Geräten</h2>
<p>Dein Kurs und die zuletzt geöffneten Kurse sind überall gleich, wo du angemeldet bist. Zu jeder Vorlesung kannst du eine private Notiz schreiben: im Plan auf <b>Notiz</b> tippen.</p></section>
<section class="account-section" aria-labelledby="notes-title"><h2 id="notes-title">Deine Notizen</h2><div data-notes-list><p class="muted">Wird geladen …</p></div></section>
<section class="account-section" aria-labelledby="pw-title"><h2 id="pw-title">Passwort ändern</h2>
<form class="account-form" data-form="password" novalidate><input type="email" name="username" autocomplete="username" value="${esc(state.user.email)}" hidden>
${field('current', 'Aktuelles Passwort', { type: 'password', autocomplete: 'current-password', extra: 'maxlength="200"' })}
${field('password', 'Neues Passwort', { type: 'password', autocomplete: 'new-password', hint: PASSWORD_HINT, extra: 'minlength="10" maxlength="200"' })}${message}
<button class="button" type="submit">Passwort ändern</button></form></section>
<section class="account-section" aria-labelledby="data-title"><h2 id="data-title">Daten und Geräte</h2>
<div class="account-actions"><button class="button button-quiet" type="button" data-account-action="logout">Abmelden</button>
<button class="button button-quiet" type="button" data-account-action="logout-all">Überall abmelden</button>
<button class="button button-quiet" type="button" data-account-action="export">Meine Daten herunterladen</button></div></section>
<section class="account-section danger" aria-labelledby="delete-title"><h2 id="delete-title">Konto löschen</h2>
<p>Löscht dein Konto, deine Einstellungen und alle Notizen sofort und endgültig.</p>
<form class="account-form" data-form="delete" novalidate>${field('password', 'Passwort zur Bestätigung', { type: 'password', autocomplete: 'current-password', extra: 'maxlength="200"' }).replace(/f-password/g, 'f-delete-password')}${message}
<button class="button button-danger" type="submit">Konto endgültig löschen</button></form></section>`),
    },
  };

  // Tokens from e-mail links arrive in the fragment (#token=…), which never
  // reaches a server; they're read once and wiped from the address bar.
  let linkToken = null;

  function show(view, { push = true, flash = '' } = {}) {
    if (view === 'konto' && !state.user) view = 'anmelden';
    if (!VIEWS[view]) view = state.user ? 'konto' : 'anmelden';
    if (['anmelden', 'registrieren'].includes(view) && state.user) view = 'konto';
    const url = `?konto=${view}`;
    if (push) history.pushState({ konto: view }, '', url);
    else history.replaceState({ konto: view }, '', url);
    app.swap({ view: 'account', name: null, main: VIEWS[view].html(), foot: '', title: `${VIEWS[view].title} · Stundenpläne der DHBW Mannheim`, animate: false });
    const main = document.querySelector('main');
    main.querySelector('form input:not([hidden])')?.focus({ preventScroll: true });
    if (flash) { const el = main.querySelector('[data-flash]'); if (el) { el.textContent = flash; el.hidden = false; } }
    if (view === 'konto') listNotes();
    if (view === 'bestaetigen') confirm();
  }

  // ?konto=<view>. Answers at once whether it's an account address; the view
  // itself waits for "who is signed in", so a signed-in user isn't shown the login.
  function route(params) {
    if (!params.has('konto')) return false;
    const match = location.hash.match(/token=([A-Za-z0-9_-]{20,100})/);
    if (match) linkToken = match[1];
    // the fragment goes at once, so the token can't stay in history or a bookmark
    if (location.hash) history.replaceState(history.state, '', location.pathname + location.search);
    document.body.dataset.view = 'account';
    ready.then(() => show(params.get('konto') || 'konto', { push: false }));
    return true;
  }

  function setMessage(form, text, ok = false) {
    const el = form.querySelector('[data-message]');
    el.textContent = text || '';
    el.hidden = !text;
    el.classList.toggle('is-ok', ok);
    el.setAttribute('role', ok ? 'status' : 'alert');
  }

  async function afterSignIn(data, flash) {
    signedIn(data);
    const back = state.returnTo || data.settings?.course;
    state.returnTo = null;
    if (back && app.byName.has(back)) app.loadCourse(back, { animate: false });
    else show('konto', { flash });
  }

  const FORMS = {
    async login(form, values) {
      const r = await api('login', { method: 'POST', body: { email: values.email, password: values.password } });
      if (!r.ok) return setMessage(form, r.data.message || 'Anmelden hat nicht geklappt.');
      await afterSignIn(r.data, 'Du bist angemeldet.');
    },
    async register(form, values) {
      const r = await api('register', { method: 'POST', body: { email: values.email, password: values.password } });
      if (!r.ok) return setMessage(form, r.data.message || 'Registrieren hat nicht geklappt.');
      form.querySelector('input[name="password"]').value = '';
      setMessage(form, `${r.data.message} Keine Mail da? Schau in den Spam-Ordner oder schicke das Formular in ein paar Minuten noch einmal ab.`, true);
    },
    async forgot(form, values) {
      const r = await api('forgot', { method: 'POST', body: { email: values.email } });
      setMessage(form, r.data.message || 'Das hat nicht geklappt.', r.ok);
    },
    async reset(form, values) {
      if (!linkToken) return setMessage(form, 'Der Link ist unvollständig. Öffne ihn bitte noch einmal aus der E-Mail.');
      const r = await api('reset', { method: 'POST', body: { token: linkToken, password: values.password } });
      if (!r.ok) return setMessage(form, r.data.message || 'Das hat nicht geklappt.');
      linkToken = null;
      signedIn(r.data);
      show('konto', { push: false, flash: 'Neues Passwort gespeichert. Du bist angemeldet.' });
    },
    async password(form, values) {
      const r = await api('password', { method: 'POST', body: { current: values.current, password: values.password } });
      if (r.status === 401) { signedOut(); return show('anmelden'); }
      if (!r.ok) return setMessage(form, r.data.message || 'Das hat nicht geklappt.');
      form.reset();
      setMessage(form, r.data.message, true);
    },
    async delete(form, values) {
      const r = await api('delete', { method: 'POST', body: { password: values.password } });
      if (!r.ok) return setMessage(form, r.data.message || 'Das hat nicht geklappt.');
      signedOut();
      app.showHome();
    },
  };

  async function confirm() {
    const status = document.querySelector('[data-verify-status]');
    if (!linkToken) { status.innerHTML = `Der Link ist unvollständig. Öffne ihn bitte noch einmal aus der E-Mail, oder ${link('anmelden', 'melde dich an')}.`; return; }
    const r = await api('verify', { method: 'POST', body: { token: linkToken } });
    linkToken = null;
    if (!r.ok) { status.innerHTML = `${esc(r.data.message || 'Das hat nicht geklappt.')} ${link('anmelden', 'Zum Anmelden')}`; return; }
    signedIn(r.data);
    show('konto', { push: false, flash: 'Konto bestätigt. Willkommen!' });
  }

  async function listNotes() {
    const slot = document.querySelector('[data-notes-list]');
    const r = await api('notes');
    if (!slot.isConnected) return;
    if (!r.ok) { slot.innerHTML = '<p class="muted">Notizen konnten nicht geladen werden.</p>'; return; }
    const notes = r.data.notes || [];
    if (!notes.length) { slot.innerHTML = '<p class="muted">Noch keine. Im Stundenplan bei einer Vorlesung auf „Notiz“ tippen.</p>'; return; }
    const fDate = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    slot.innerHTML = `<ul class="note-list">${notes.map((n) => `<li><p class="note-list-head"><a href="?kurs=${encodeURIComponent(n.course)}" data-course-link="${esc(n.course)}">${esc(n.course)}</a> · ${esc(n.eventName || 'Termin')}${n.eventStart ? ` · ${esc(fDate.format(new Date(n.eventStart)))}` : ''}</p><p class="note-list-body">${esc(n.body)}</p></li>`).join('')}</ul>`;
  }

  async function action(name) {
    if (name === 'logout' || name === 'logout-all') {
      await api(name, { method: 'POST', body: {} });
      signedOut();
      show('anmelden', { push: false });
    } else if (name === 'export') {
      const r = await api('export');
      if (!r.ok) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: 'stundenplan-konto.json' });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  // one listener each for every view's forms and buttons
  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    const button = form.querySelector('[type="submit"]');
    if (button.getAttribute('aria-busy') === 'true') return; // no double submits
    const values = Object.fromEntries(new FormData(form));
    const empty = [...form.querySelectorAll('input[required]:not([hidden])')].find((i) => !i.value.trim());
    if (empty) { setMessage(form, 'Bitte alle Felder ausfüllen.'); empty.focus(); return; }
    setMessage(form, '');
    button.setAttribute('aria-busy', 'true');
    try { await FORMS[form.dataset.form](form, values); } finally { button.removeAttribute('aria-busy'); }
  });

  document.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button > 0) return;
    const reveal = e.target.closest('[data-reveal-password]');
    if (reveal) {
      const input = document.getElementById(reveal.getAttribute('aria-controls'));
      const visible = input.type === 'password';
      input.type = visible ? 'text' : 'password';
      reveal.setAttribute('aria-pressed', String(visible));
      reveal.textContent = visible ? 'Verbergen' : 'Anzeigen';
      return;
    }
    const view = e.target.closest('[data-account-view]');
    if (view) { e.preventDefault(); show(view.dataset.accountView); return; }
    const head = e.target.closest('[data-account-link]');
    if (head) {
      e.preventDefault();
      state.returnTo = app.getCurrent();
      show(state.user ? 'konto' : 'anmelden');
      return;
    }
    const act = e.target.closest('[data-account-action]');
    if (act) { action(act.dataset.accountAction); return; }
    const note = e.target.closest('[data-note]');
    if (note) openNote(note.closest('.session'));
  });

  // ---------- notes on the timetable ----------

  async function courseShown(name) {
    courseOpened(name);
    if (!state.user) return decorate();
    if (state.notesCourse !== name) {
      state.notes.clear();
      state.notesCourse = name;
      const r = await api('notes', { query: { course: name } });
      if (state.notesCourse !== name) return; // another course opened meanwhile
      if (r.status === 401) return signedOut();
      for (const n of r.data.notes || []) state.notes.set(n.eventId, n);
    }
    decorate();
  }

  // A "Notiz" button on every lecture, and the note itself under it.
  function decorate() {
    const on = !!state.user && state.notesCourse === app.getCurrent();
    document.querySelectorAll('main .session[data-id]').forEach((s) => {
      let button = s.querySelector('[data-note]');
      let text = s.querySelector('.session-note');
      if (!on || !s.dataset.id) { button?.remove(); text?.remove(); return; }
      const note = state.notes.get(s.dataset.id);
      if (!button) {
        button = Object.assign(document.createElement('button'), { type: 'button', className: 'note-button' });
        button.dataset.note = '';
        s.querySelector('.session-meta').after(button);
      }
      button.textContent = note ? 'Notiz bearbeiten' : 'Notiz';
      button.setAttribute('aria-label', `${note ? 'Notiz bearbeiten' : 'Notiz schreiben'}: ${s.querySelector('.session-title').textContent}`);
      if (note) {
        if (!text) { text = Object.assign(document.createElement('p'), { className: 'session-note' }); button.before(text); }
        text.textContent = note.body; // as text, never as HTML
      } else {
        text?.remove();
      }
    });
  }

  let dialog = null;
  function openNote(session) {
    if (!session || !state.user) return;
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.className = 'note-dialog';
      dialog.setAttribute('aria-labelledby', 'note-title');
      dialog.innerHTML = `<form class="note-form" data-note-form novalidate>
<p class="note-when" data-note-when></p><h2 class="note-title" id="note-title" data-note-title></h2>
<label class="field-label" for="note-body">Deine Notiz (nur für dich sichtbar)</label>
<textarea id="note-body" name="body" rows="6" maxlength="2000" placeholder="Hausaufgabe, Raumänderung, was mitbringen …"></textarea>
<p class="note-count" data-note-count aria-live="polite"></p>
<p class="form-message" data-message role="alert" hidden></p>
<div class="note-actions"><button class="button button-quiet" type="button" data-note-delete>Löschen</button><span></span>
<button class="button button-quiet" type="button" data-note-cancel>Abbrechen</button><button class="button" type="submit">Speichern</button></div></form>`;
      document.body.append(dialog);
      const area = dialog.querySelector('textarea');
      const count = () => { dialog.querySelector('[data-note-count]').textContent = `${[...area.value].length} / 2000`; };
      area.addEventListener('input', count);
      dialog.querySelector('[data-note-cancel]').addEventListener('click', () => dialog.close());
      dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); }); // backdrop
      dialog.querySelector('[data-note-delete]').addEventListener('click', () => saveNote(''));
      dialog.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); saveNote(area.value); });
      dialog.count = count;
    }
    const id = session.dataset.id;
    const note = state.notes.get(id);
    dialog.target = { id, session, name: session.querySelector('.session-title').textContent, start: new Date(+session.dataset.start).toISOString() };
    dialog.querySelector('[data-note-title]').textContent = dialog.target.name;
    dialog.querySelector('[data-note-when]').textContent = `${session.closest('.day')?.querySelector('.day-name')?.textContent || ''}, ${session.querySelector('.session-time')?.textContent || ''}`;
    dialog.querySelector('textarea').value = note?.body || '';
    dialog.querySelector('[data-note-delete]').hidden = !note;
    setMessage(dialog.querySelector('form'), '');
    dialog.count();
    dialog.showModal();
    dialog.querySelector('textarea').focus();
  }

  async function saveNote(body) {
    const form = dialog.querySelector('form');
    const t = dialog.target;
    const r = await api('note', { method: 'PUT', body: { course: app.getCurrent(), eventId: t.id, eventName: t.name, eventStart: t.start, body } });
    if (r.status === 401) { dialog.close(); signedOut(); return show('anmelden'); }
    if (!r.ok) return setMessage(form, r.data.message || 'Speichern hat nicht geklappt.');
    if (r.data.note) state.notes.set(t.id, r.data.note); else state.notes.delete(t.id);
    decorate();
    dialog.close();
    t.session.querySelector('[data-note]')?.focus();
  }

  // ---------- start ----------

  const ready = api('me').then((r) => {
    state.available = r.ok; // 503: no database here; 0: offline (the link stays hidden)
    if (r.ok && r.data.user) signedIn(r.data);
    renderHeader();
    const current = app.getCurrent();
    if (current && state.user) courseShown(current);
  });

  return { route, courseShown, decorate };
}
