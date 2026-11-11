// The two pages of the admin area (see _admin.js): the sign-in form, which
// anyone opening /admin gets, and the panel, which is only ever sent to a
// signed-in admin. Each is one self-contained document: its style and script
// are inline and carry the nonce of that answer, and the Content-Security-
// Policy in the page allows nothing else to run or load.
//
// The scripts are ordinary functions below (loginScript, panelScript), put
// into the page with toString(). They run in the browser, so they use
// nothing from this file. Everything they show goes through textContent.

const CSS = `
:root {
  color-scheme: light dark;
  --bg: #f5f5f7; --surface: #ffffff; --surface-2: #e8e8ed; --text: #1d1d1f; --muted: #6e6e73;
  --hairline: rgb(0 0 0 / 0.08); --danger: #d70015; --danger-soft: rgb(215 0 21 / 0.08); --focus: #0071e3;
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #000000; --surface: #1c1c1e; --surface-2: #2c2c2e; --text: #f5f5f7; --muted: #98989d;
    --hairline: rgb(255 255 255 / 0.1); --danger: #ff6961; --danger-soft: rgb(255 69 58 / 0.14); --focus: #409cff;
  }
}
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
h1, h2, p, ul, ol { margin: 0; }
ul, ol { padding: 0; list-style: none; }
a { color: inherit; text-underline-offset: 2px; }
[hidden] { display: none !important; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }

.button {
  display: inline-flex; align-items: center; justify-content: center; min-height: 36px; padding: 0 14px;
  border: 0; border-radius: 999px; background: var(--text); color: var(--bg);
  font: inherit; font-size: 0.875rem; font-weight: 600; cursor: pointer;
  transition: transform 160ms var(--ease-out), opacity 150ms ease;
}
.button:active { transform: scale(0.97); }
.button.quiet { background: var(--surface-2); color: var(--text); }
.button.danger { background: var(--danger-soft); color: var(--danger); }
.button.wide { width: 100%; min-height: 44px; font-size: 0.9375rem; }
.button[aria-busy="true"] { opacity: 0.55; pointer-events: none; }
@media (hover: hover) and (pointer: fine) { .button:hover { opacity: 0.86; } }

input, select {
  min-height: 44px; padding: 0 14px; border: 1px solid transparent; border-radius: 12px;
  background: var(--surface); color: var(--text); font: inherit; font-size: 16px;
}
input:focus-visible, select:focus-visible { outline: none; border-color: var(--focus); box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus) 25%, transparent); }

.message { padding: 10px 14px; border-radius: 12px; background: var(--danger-soft); color: var(--danger); font-size: 0.9375rem; }

/* sign-in */
.login { display: grid; place-items: center; min-height: 100dvh; padding: 24px 16px; }
.card { display: grid; gap: 14px; width: min(380px, 100%); }
.card h1 { margin-bottom: 6px; font-size: 1.75rem; line-height: 1.15; letter-spacing: -0.02em; }
.card label { font-size: 0.875rem; font-weight: 600; }
.card input { width: 100%; }

/* panel */
.top { display: flex; align-items: center; gap: 16px; padding: 14px max(16px, env(safe-area-inset-left)); }
.brand { flex: 1; }
.brand span { color: var(--muted); }
.top a { color: var(--muted); font-size: 0.875rem; }
.tabs { display: flex; gap: 6px; padding: 4px max(16px, env(safe-area-inset-left)) 12px; overflow-x: auto; scrollbar-width: none; border-bottom: 1px solid var(--hairline); }
.tabs button {
  flex-shrink: 0; min-height: 36px; padding: 0 14px; border: 0; border-radius: 999px; background: var(--surface); color: var(--text);
  font: inherit; font-size: 0.875rem; font-weight: 550; cursor: pointer; transition: transform 160ms var(--ease-out);
}
.tabs button:active { transform: scale(0.97); }
.tabs button[aria-pressed="true"] { background: var(--text); color: var(--bg); }
main.panel { width: min(960px, 100%); margin: 0 auto; padding: 28px 16px 96px; }
main.panel h1 { font-size: 1.75rem; line-height: 1.15; letter-spacing: -0.02em; }
main.panel h2 { margin: 32px 0 10px; font-size: 1.125rem; }
.lead { margin-top: 6px; color: var(--muted); }
.empty { padding: 18px; border-radius: 14px; background: var(--surface); color: var(--muted); }

.stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin-top: 20px; }
.stat { padding: 14px 16px; border-radius: 14px; background: var(--surface); }
.stat b { display: block; font-size: 1.75rem; line-height: 1.1; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.stat span { color: var(--muted); font-size: 0.8125rem; }

.rows { display: grid; gap: 8px; margin-top: 16px; }
.row { display: grid; gap: 8px; padding: 14px 16px; border-radius: 14px; background: var(--surface); }
.row-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; color: var(--muted); font-size: 0.8125rem; }
.row-head b { color: var(--text); font-size: 0.9375rem; font-weight: 600; overflow-wrap: anywhere; }
.row-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.row-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.row-actions .button { min-height: 32px; padding: 0 12px; font-size: 0.8125rem; }
.tag { padding: 1px 8px; border-radius: 999px; background: var(--surface-2); color: var(--text); font-size: 0.75rem; font-weight: 600; }
.tag.warn { background: var(--danger-soft); color: var(--danger); }
button.link { padding: 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }

.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 16px; }
.toolbar label { display: inline-flex; align-items: center; gap: 8px; color: var(--muted); font-size: 0.875rem; }
.toolbar input { flex: 1; min-width: 180px; }
.more { margin-top: 12px; }

.toast {
  position: fixed; left: 50%; bottom: calc(20px + env(safe-area-inset-bottom)); transform: translateX(-50%);
  max-width: calc(100vw - 32px); padding: 10px 16px; border-radius: 999px; background: var(--text); color: var(--bg);
  font-size: 0.875rem; font-weight: 600; box-shadow: 0 8px 24px rgb(0 0 0 / 0.25);
}
@media (prefers-reduced-motion: reduce) { .button:active, .tabs button:active { transform: none; } }
`;

// One document. Only what carries this answer's nonce may run or apply;
// nothing loads from anywhere but this site.
const page = ({ nonce, title, body, script }) => `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title>${title}</title>
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
<style nonce="${nonce}">${CSS}</style>
</head>
<body>
${body}
<script nonce="${nonce}">(${script.toString()})();</script>
</body>
</html>
`;

// ---------- the sign-in form ----------

function loginScript() {
  const form = document.querySelector('form');
  const message = form.querySelector('.message');
  const button = form.querySelector('button');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = form.querySelector('input[type="password"]').value;
    if (!password || button.getAttribute('aria-busy') === 'true') return;
    button.setAttribute('aria-busy', 'true');
    message.hidden = true;
    let ok = false;
    let data = {};
    try {
      const res = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      ok = res.ok;
      data = await res.json();
    } catch (err) { /* offline, or no JSON in the answer */ }
    if (ok) { location.reload(); return; } // the same address now answers with the panel
    button.removeAttribute('aria-busy');
    message.textContent = data.message || 'Keine Verbindung. Bitte noch einmal versuchen.';
    message.hidden = false;
  });
}

export const loginPage = (nonce) => page({
  nonce,
  title: 'Anmelden',
  script: loginScript,
  body: `<main class="login"><form class="card" novalidate>
<h1>Adminbereich</h1>
<input type="text" name="username" autocomplete="username" value="admin" hidden>
<label for="password">Passwort</label>
<input id="password" name="password" type="password" autocomplete="current-password" maxlength="400" required autofocus>
<p class="message" role="alert" hidden></p>
<button class="button wide" type="submit">Anmelden</button>
</form></main>`,
});

// ---------- the panel ----------

function panelScript() {
  const $ = (selector, root = document) => root.querySelector(selector);
  const fDate = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const when = (t) => (t ? fDate.format(new Date(t)) : '');
  const roomName = (room) => (room === 'global' ? 'Offener Chat („Alle“)' : room);

  // el('p', { class: 'x', text: '…' }, child, child): never innerHTML, so whatever people wrote stays text
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'text') node.textContent = value;
      else if (key === 'class') node.className = value;
      else if (key === 'click') node.addEventListener('click', value);
      else node.setAttribute(key, value);
    }
    node.append(...children.filter(Boolean));
    return node;
  }
  const button = (text, click, kind = 'quiet') => el('button', { class: `button ${kind}`, type: 'button', text, click });

  // An answer of the API. A session that ran out leads back to the sign-in form.
  async function api(action, { query = null, body = null } = {}) {
    let res = null;
    let data = {};
    try {
      res = await fetch(`/api/admin/${action}${query ? `?${new URLSearchParams(query)}` : ''}`, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      data = await res.json();
    } catch (err) { /* offline, or no JSON in the answer */ }
    if (res && res.status === 401) { location.reload(); return null; }
    if (!res || !res.ok) { toast(data.message || 'Das hat nicht geklappt. Bitte noch einmal versuchen.'); return null; }
    return data;
  }

  let toastTimer = null;
  function toast(text) {
    const node = $('.toast');
    node.textContent = text;
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.hidden = true; }, 4000);
  }

  // A change: ask first if it can't be undone, do it, say so, redraw.
  async function change(action, body, { ask = '', done, then }) {
    if (ask && !confirm(ask)) return;
    const data = await api(action, { body });
    if (!data) return;
    toast(typeof done === 'function' ? done(data) : done);
    then();
  }

  // ---- overview ----

  async function loadOverview() {
    const data = await api('overview');
    if (!data) return;
    const stats = [
      ['Konten', data.users], ['mit Anzeigename', data.named], ['neu in 7 Tagen', data.newUsers], ['aktive Anmeldungen', data.sessions],
      ['Notizen', data.notes], ['Chat-Nachrichten', data.messages], ['davon in 24 Std.', data.messagesDay], ['gesperrte Absender', data.bans],
    ];
    $('[data-stats]').replaceChildren(...stats.map(([label, n]) => el('div', { class: 'stat' }, el('b', { text: n.toLocaleString('de-DE') }), el('span', { text: label }))));

    $('[data-rooms]').replaceChildren(...(data.rooms.length
      ? data.rooms.map((r) => el('li', { class: 'row' }, el('p', { class: 'row-head' },
        el('button', { class: 'link', type: 'button', click: () => openChat(r.room) }, el('b', { text: roomName(r.room) })),
        el('span', { text: `${r.messages.toLocaleString('de-DE')} ${r.messages === 1 ? 'Nachricht' : 'Nachrichten'}` }),
        el('span', { text: `zuletzt ${when(r.last)}` }))))
      : [el('li', { class: 'empty', text: 'Im Chat hat noch niemand geschrieben.' })]));

    $('[data-settings]').replaceChildren(
      el('li', { class: 'row' }, el('p', { class: 'row-head' }, el('b', { text: 'Gäste im Chat' }),
        el('span', { text: data.settings.guests ? 'dürfen schreiben. Abschalten: CHAT_GUESTS=off in Vercel setzen und neu deployen.' : 'dürfen nicht schreiben (CHAT_GUESTS=off).' }))),
      el('li', { class: 'row' }, el('p', { class: 'row-head' }, el('b', { text: 'E-Mail-Versand' }),
        el('span', { text: data.settings.mail ? `über ${data.settings.mail}` : 'nicht eingerichtet: Registrieren geht so nicht.' }))),
    );

    // the rooms on offer in the chat tab
    const select = $('[data-room]');
    const chosen = select.value;
    select.replaceChildren(el('option', { value: '', text: 'Alle Chats' }), ...data.rooms.map((r) => el('option', { value: r.room, text: roomName(r.room) })));
    select.value = [...select.options].some((o) => o.value === chosen) ? chosen : '';
  }

  // ---- chat ----

  let oldest = null; // the id of the last message shown, for "Ältere laden"

  function messageRow(m) {
    const reload = () => loadMessages();
    return el('li', { class: 'row' },
      el('p', { class: 'row-head' },
        el('b', { text: m.name }),
        el('span', { text: m.email || 'Gast' }),
        el('span', { class: 'tag', text: roomName(m.room) }),
        m.banned ? el('span', { class: 'tag warn', text: 'gesperrt' }) : null,
        el('span', { text: when(m.at) })),
      el('p', { class: 'row-text', text: m.body }),
      el('div', { class: 'row-actions' },
        button('Löschen', () => change('delete-message', { id: m.id }, { done: 'Nachricht gelöscht.', then: reload }), 'danger'),
        button('Alles von diesem Absender löschen', () => change('delete-sender', { sender: m.sender }, {
          ask: `Alle Nachrichten von „${m.name}“ in allen Chats löschen? Das lässt sich nicht rückgängig machen.`,
          done: (d) => `${d.deleted} ${d.deleted === 1 ? 'Nachricht' : 'Nachrichten'} gelöscht.`, then: reload,
        }), 'danger'),
        m.banned
          ? button('Entsperren', () => change('unban', { sender: m.sender }, { done: `„${m.name}“ darf wieder schreiben.`, then: reload }))
          : button('Sperren', () => change('ban', { sender: m.sender }, {
            ask: `„${m.name}“ sperren? Der Absender kann dann nicht mehr schreiben.${m.email ? '' : ' Ein Gast bekommt allerdings eine neue Nummer, wenn er seine Cookies löscht.'}`,
            done: `„${m.name}“ ist gesperrt.`, then: reload,
          }))));
  }

  async function loadMessages({ older = false } = {}) {
    const query = {};
    if ($('[data-room]').value) query.room = $('[data-room]').value;
    if (older && oldest) query.before = oldest;
    const data = await api('messages', { query });
    if (!data) return;
    const list = $('[data-messages]');
    const rows = data.messages.map(messageRow);
    if (older) list.append(...rows);
    else list.replaceChildren(...(rows.length ? rows : [el('li', { class: 'empty', text: 'Keine Nachrichten.' })]));
    if (data.messages.length) oldest = data.messages.at(-1).id;
    $('[data-more]').hidden = !data.more;
  }

  function openChat(room) {
    $('[data-room]').value = room;
    show('chat');
  }

  // ---- accounts ----

  function userRow(u) {
    const reload = () => loadUsers();
    return el('li', { class: 'row' },
      el('p', { class: 'row-head' },
        el('b', { text: u.email }),
        el('span', { text: u.name ? `im Chat: ${u.name}` : 'ohne Anzeigename' }),
        el('span', { text: `seit ${when(u.createdAt)}` }),
        el('span', { text: `${u.notes} ${u.notes === 1 ? 'Notiz' : 'Notizen'} · ${u.messages} ${u.messages === 1 ? 'Nachricht' : 'Nachrichten'}` })),
      el('div', { class: 'row-actions' },
        u.name ? button('Anzeigenamen entfernen', () => change('clear-name', { id: u.id }, {
          ask: `Den Anzeigenamen „${u.name}“ entfernen? Das Konto schreibt dann wieder als „Nutzer“ mit Nummer.`,
          done: 'Anzeigename entfernt.', then: reload,
        })) : null,
        button('Konto löschen', () => change('delete-user', { id: u.id }, {
          ask: `Das Konto ${u.email} mit allen Notizen und Chat-Nachrichten löschen? Das lässt sich nicht rückgängig machen.`,
          done: 'Konto gelöscht.', then: reload,
        }), 'danger')));
  }

  async function loadUsers() {
    const q = $('[data-search] input').value.trim();
    const data = await api('users', { query: q ? { q } : null });
    if (!data) return;
    const rows = data.users.map(userRow);
    $('[data-users]').replaceChildren(...(rows.length ? rows : [el('li', { class: 'empty', text: q ? 'Kein Konto passt dazu.' : 'Noch keine Konten.' })]));
    $('[data-users-more]').hidden = !data.more;
  }

  // ---- banned senders ----

  async function loadBans() {
    const data = await api('bans');
    if (!data) return;
    $('[data-bans]').replaceChildren(...(data.bans.length
      ? data.bans.map((b) => el('li', { class: 'row' },
        el('p', { class: 'row-head' }, el('b', { text: b.name || 'Unbekannt' }), el('span', { text: `gesperrt seit ${when(b.at)}` })),
        el('div', { class: 'row-actions' }, button('Entsperren', () => change('unban', { sender: b.sender }, { done: 'Entsperrt.', then: loadBans })))))
      : [el('li', { class: 'empty', text: 'Niemand ist gesperrt.' })]));
  }

  // ---- tabs ----

  const LOAD = { overview: loadOverview, chat: loadMessages, users: loadUsers, bans: loadBans };

  // Every view loads when it is opened, so it never shows an old state.
  function show(name) {
    document.querySelectorAll('[data-view]').forEach((view) => { view.hidden = view.dataset.view !== name; });
    document.querySelectorAll('[data-tab]').forEach((tab) => tab.setAttribute('aria-pressed', String(tab.dataset.tab === name)));
    LOAD[name]();
  }

  document.querySelectorAll('[data-tab]').forEach((tab) => tab.addEventListener('click', () => show(tab.dataset.tab)));
  $('[data-room]').addEventListener('change', () => loadMessages());
  $('[data-reload]').addEventListener('click', () => loadMessages());
  $('[data-more]').addEventListener('click', () => loadMessages({ older: true }));
  $('[data-search]').addEventListener('submit', (e) => { e.preventDefault(); loadUsers(); });
  $('[data-logout]').addEventListener('click', async () => {
    await api('logout', { body: {} });
    location.reload();
  });

  show('overview');
}

export const panelPage = (nonce) => page({
  nonce,
  title: 'Admin · Stundenplan',
  script: panelScript,
  body: `<header class="top"><p class="brand"><strong>Stundenplan</strong> <span>Admin</span></p><a href="/">Zur Seite</a><button class="button quiet" type="button" data-logout>Abmelden</button></header>
<nav class="tabs" aria-label="Bereiche">
<button type="button" data-tab="overview" aria-pressed="true">Übersicht</button>
<button type="button" data-tab="chat" aria-pressed="false">Chat</button>
<button type="button" data-tab="users" aria-pressed="false">Konten</button>
<button type="button" data-tab="bans" aria-pressed="false">Gesperrt</button>
</nav>
<main class="panel">
<section data-view="overview">
<h1>Übersicht</h1>
<div class="stats" data-stats></div>
<h2>Chats</h2>
<ul class="rows" data-rooms></ul>
<h2>Einstellungen</h2>
<ul class="rows" data-settings></ul>
</section>
<section data-view="chat" hidden>
<h1>Chat</h1>
<p class="lead">Die neuesten Nachrichten zuerst. Gelöschte Nachrichten verschwinden bei allen, sobald sie den Chat neu öffnen.</p>
<div class="toolbar"><label>Chat <select data-room><option value="">Alle Chats</option></select></label><button class="button quiet" type="button" data-reload>Neu laden</button></div>
<ol class="rows" data-messages></ol>
<button class="button quiet more" type="button" data-more hidden>Ältere laden</button>
</section>
<section data-view="users" hidden>
<h1>Konten</h1>
<p class="lead">Die neuesten Konten zuerst.</p>
<form class="toolbar" data-search><input type="search" placeholder="E-Mail oder Anzeigename" aria-label="Konten suchen" maxlength="100" autocomplete="off"><button class="button quiet" type="submit">Suchen</button></form>
<ul class="rows" data-users></ul>
<p class="lead more" data-users-more hidden>Es gibt mehr Konten als hier stehen. Suche, um ein bestimmtes zu finden.</p>
</section>
<section data-view="bans" hidden>
<h1>Gesperrt</h1>
<p class="lead">Wer hier steht, kann im Chat nicht schreiben. Sperren geht im Bereich „Chat“ an einer Nachricht.</p>
<ul class="rows" data-bans></ul>
</section>
</main>
<p class="toast" role="status" hidden></p>`,
});
