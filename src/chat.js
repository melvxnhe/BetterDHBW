// The chat: a button at the bottom right that opens a small panel with one
// room for everyone and one per course. The server side is api/_chat.js.
// Messages are fetched every few seconds while the panel is open (there is
// no push on this hosting), and always shown as text, never as HTML.
//
// setupChat({ recent, current }) returns { enable, rooms, identityChanged }:
// - recent(), current(): the courses opened last and the one on screen; they
//   are the course rooms on offer
// - enable(): shows the button (once app.js knows the server has a database)
// - rooms(): the view changed, so the rooms on offer may have
// - identityChanged(): someone signed in or out, or picked a name
function setupChat({ recent, current }) {
  const GLOBAL = 'global';
  const STORE = 'dhbw-ma-chat'; // localStorage: the room chosen last
  const FAST = 4000;    // between polls while the panel is open …
  const SLOW = 10000;   // … once nothing new has come for a while,
  const QUIET = 12;     // that is after this many polls without news,
  const IDLE = 30000;   // and while the panel is closed (for the dot on the button)
  const KEEP = 200;     // messages held per room
  const NEAR = 80;      // px from the end that still counts as "reading the newest"
  const GROUP = 5 * 60 * 1000; // messages from one sender within this time share one name line
  const finePointer = matchMedia('(pointer: fine)');

  const fTime = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  const fDay = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
  const dayKey = (t) => keyOf(partsOf(t));

  const ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M5 3h10a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H9.500l-3.700 2.800A.5.5 0 0 1 5 17.400V15a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z"/></svg>';
  const ICON_SEND = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.800" stroke-linecap="round" stroke-linejoin="round" d="M8 13V3.500M4 7.500l4-4 4 4"/></svg>';

  const root = document.createElement('div');
  root.className = 'chat';
  root.hidden = true;
  root.innerHTML = `<button class="chat-fab" type="button" aria-expanded="false" aria-controls="chat-panel" aria-label="Chat öffnen">${ICON}<span class="chat-dot" hidden></span></button>
<section class="chat-panel" id="chat-panel" role="dialog" aria-label="Chat" tabindex="-1" inert>
<header class="chat-head"><h2 class="chat-title">Chat</h2><button class="chat-close" type="button" aria-label="Chat schließen"><svg viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="m4 4 8 8m0-8-8 8"/></svg></button></header>
<div class="chat-rooms" role="group" aria-label="Chat wählen"></div>
<div class="chat-body">
<ol class="chat-list" role="log" aria-label="Nachrichten" tabindex="0"></ol>
<p class="chat-state" data-chat-state></p>
<button class="chat-new" type="button" hidden>Neue Nachrichten</button>
</div>
<form class="chat-form" novalidate>
<p class="chat-as" data-chat-as></p>
<p class="form-message" data-chat-error role="alert" hidden></p>
<div class="chat-compose"><textarea rows="1" aria-label="Nachricht" enterkeyhint="send" autocomplete="off"></textarea><button class="chat-send" type="submit" aria-label="Senden">${ICON_SEND}</button></div>
</form>
</section>`;
  document.body.append(root);

  const fab = root.querySelector('.chat-fab');
  const dot = root.querySelector('.chat-dot');
  const panel = root.querySelector('.chat-panel');
  const roomsEl = root.querySelector('.chat-rooms');
  const list = root.querySelector('.chat-list');
  const stateEl = root.querySelector('[data-chat-state]');
  const newer = root.querySelector('.chat-new');
  const form = root.querySelector('.chat-form');
  const asEl = root.querySelector('[data-chat-as]');
  const errorEl = root.querySelector('[data-chat-error]');
  const area = root.querySelector('textarea');
  const sendButton = root.querySelector('.chat-send');

  const stored = (() => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } })();

  let enabled = false;
  let open = false;
  let everOpened = false;
  let room = /^[A-Z0-9-]{1,40}$/.test(stored.room) ? stored.room : GLOBAL; // a course, else the room for everyone
  let you = null;      // { id, name, guest, named }; null until the server says, and for someone who may not write
  let guests = true;   // whether people without an account may write
  let max = 500;       // characters per message, as the server says
  let quiet = 0;       // polls in a row that brought nothing
  let timer = null;
  const loaded = new Map(); // room → { messages (by id, ascending), last (highest id a poll returned), failed }

  const roomOf = (name) => {
    if (!loaded.has(name)) loaded.set(name, { messages: [], last: null, failed: false });
    return loaded.get(name);
  };
  const label = (name) => (name === GLOBAL ? 'Alle' : name);

  async function request(action, { query = null, body = null } = {}) {
    try {
      const res = await fetch(`api/chat/${action}${query ? `?${new URLSearchParams(query)}` : ''}`, {
        method: body ? 'POST' : 'GET', credentials: 'same-origin',
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

  // ---------- rooms ----------

  // "Alle", the course on screen, the courses opened last, and whatever room is open
  function rooms() {
    const names = [...new Set([GLOBAL, current(), ...recent(), room].filter(Boolean))].slice(0, 5);
    if (!names.includes(room)) names[names.length - 1] = room;
    roomsEl.replaceChildren(...names.map((name) => {
      const chip = Object.assign(document.createElement('button'), { type: 'button', className: 'chip', textContent: label(name) });
      chip.dataset.chatRoom = name;
      chip.setAttribute('aria-pressed', String(name === room));
      return chip;
    }));
    area.placeholder = room === GLOBAL ? 'Nachricht an alle' : `Nachricht an ${room}`;
  }

  function pick(name) {
    if (name === room) return;
    room = name;
    try { localStorage.setItem(STORE, JSON.stringify({ room })); } catch { /* private mode */ }
    quiet = 0;
    rooms();
    render({ toEnd: true });
    poll();
  }

  // ---------- messages ----------

  // New messages into a room's list: by id, each once, the oldest dropped.
  function merge(state, messages) {
    const known = new Set(state.messages.map((m) => m.id));
    const fresh = messages.filter((m) => !known.has(m.id));
    if (!fresh.length) return fresh;
    state.messages = [...state.messages, ...fresh].sort((a, b) => a.id - b.id).slice(-KEEP);
    return fresh;
  }

  function dayLabel(t, now) {
    const days = Math.round((Date.parse(dayKey(now)) - Date.parse(dayKey(t))) / 864e5);
    return days === 0 ? 'Heute' : days === 1 ? 'Gestern' : fDay.format(t);
  }

  // Everything through textContent: a message is text, whatever it contains.
  function messageEl(m, previous, now) {
    const at = Date.parse(m.at);
    const mine = !!you && m.from === you.id;
    const item = document.createElement('li');
    item.className = `chat-msg${mine ? ' is-mine' : ''}`;
    const newDay = !previous || dayKey(Date.parse(previous.at)) !== dayKey(at);
    if (newDay) {
      const day = Object.assign(document.createElement('p'), { className: 'chat-day', textContent: dayLabel(at, now) });
      item.append(day);
    }
    // a name line when the sender changes, after a pause, and on a new day
    if (newDay || previous.from !== m.from || at - Date.parse(previous.at) > GROUP) {
      const head = document.createElement('p');
      head.className = 'chat-meta';
      // dir="auto": an Arabic name or message reads right to left, its punctuation included
      if (!mine) head.append(Object.assign(document.createElement('b'), { textContent: m.name, className: m.guest ? 'is-guest' : '', dir: 'auto' }), ' ');
      head.append(Object.assign(document.createElement('time'), { dateTime: new Date(at).toISOString(), textContent: fTime.format(at) }));
      item.append(head);
    }
    item.append(Object.assign(document.createElement('p'), { className: 'chat-text', textContent: m.body, dir: 'auto' }));
    return item;
  }

  const atEnd = () => list.scrollHeight - list.scrollTop - list.clientHeight < NEAR;
  const toEnd = () => { list.scrollTop = list.scrollHeight; newer.hidden = true; };

  // Draws the open room. Someone reading the newest messages stays at the
  // end; someone reading further up stays where they are and gets a button.
  function render({ toEnd: jump = false, fresh = 0 } = {}) {
    const state = roomOf(room);
    const follow = jump || atEnd();
    const now = Date.now();
    list.replaceChildren(...state.messages.map((m, i) => messageEl(m, state.messages[i - 1], now)));
    stateEl.textContent = state.messages.length ? ''
      : state.failed ? 'Der Chat ist gerade nicht erreichbar.'
        : state.last === null ? 'Wird geladen …'
          : room === GLOBAL ? 'Noch keine Nachrichten. Schreib die erste.' : `Noch keine Nachrichten in ${room}. Schreib die erste.`;
    stateEl.hidden = !stateEl.textContent;
    if (follow) toEnd();
    else if (fresh) newer.hidden = false;
  }

  // Fetches what is new in the open room.
  async function load() {
    const name = room;
    const state = roomOf(name);
    const r = await request('messages', { query: state.last === null ? { room: name } : { room: name, after: state.last } });
    state.failed = !r.ok;
    if (!r.ok) { if (name === room) render(); return; }
    const first = state.last === null;
    const got = r.data.messages || [];
    const fresh = merge(state, got);
    state.last = Math.max(state.last || 0, ...got.map((m) => m.id));
    quiet = fresh.length ? 0 : quiet + 1;
    const fromOthers = fresh.filter((m) => !you || m.from !== you.id).length;
    if (!open && !first && fromOthers) dot.hidden = false;
    if (name === room && (fresh.length || first)) render({ toEnd: first, fresh: fromOthers });
  }

  // ---------- polling ----------

  function schedule() {
    clearTimeout(timer);
    if (!enabled || !everOpened || document.hidden) return;
    timer = setTimeout(poll, open ? (quiet > QUIET ? SLOW : FAST) : IDLE);
  }

  async function poll() {
    clearTimeout(timer);
    await load();
    schedule();
  }

  document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(timer); else if (everOpened) poll(); });
  addEventListener('online', () => { if (everOpened) poll(); });

  // ---------- who you are ----------

  function renderIdentity() {
    const link = (view, text) => `<a href="?konto=${view}" data-account-view="${view}">${text}</a>`;
    // the field is only closed to someone who may not write: signed out, with guests turned off
    area.disabled = sendButton.disabled = !you && !guests;
    if (!you) {
      asEl.innerHTML = guests ? 'Einen Moment …' : `Zum Schreiben bitte ${link('anmelden', 'anmelden')}.`;
      return;
    }
    asEl.textContent = 'Du schreibst als ';
    asEl.append(Object.assign(document.createElement('b'), { textContent: you.name }), ' · ');
    asEl.insertAdjacentHTML('beforeend', you.guest ? link('anmelden', 'Anmelden') : link('konto', you.named ? 'Name ändern' : 'Name wählen'));
  }

  async function loadIdentity() {
    const r = await request('me');
    if (!r.ok) return;
    you = r.data.you || null;
    guests = r.data.guests !== false;
    max = r.data.max || max;
    area.maxLength = max;
    renderIdentity();
    render(); // which messages are yours may have changed
  }

  function identityChanged() {
    you = null;
    if (everOpened) loadIdentity();
  }

  // ---------- opening and closing ----------

  // `animate`: only for a pointer; keyboard actions are instant.
  function show({ animate }) {
    open = true;
    panel.classList.toggle('is-instant', !animate);
    root.classList.add('is-open');
    panel.inert = false;
    fab.setAttribute('aria-expanded', 'true');
    fab.setAttribute('aria-label', 'Chat schließen');
    dot.hidden = true;
    quiet = 0;
    rooms();
    render({ toEnd: true });
    if (!everOpened) { everOpened = true; loadIdentity(); }
    poll();
    // on a phone, focusing the field would throw the keyboard over the messages
    (finePointer.matches && !area.disabled ? area : panel).focus({ preventScroll: true });
  }

  function hide({ animate, focus = false }) {
    open = false;
    panel.classList.toggle('is-instant', !animate);
    root.classList.remove('is-open');
    panel.inert = true;
    fab.setAttribute('aria-expanded', 'false');
    fab.setAttribute('aria-label', 'Chat öffnen');
    if (focus) fab.focus({ preventScroll: true });
    schedule();
  }

  // detail is 0 for Enter/Space
  fab.addEventListener('click', (e) => (open ? hide({ animate: e.detail !== 0 }) : show({ animate: e.detail !== 0 })));
  root.querySelector('.chat-close').addEventListener('click', (e) => hide({ animate: e.detail !== 0, focus: e.detail === 0 }));
  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    hide({ animate: false, focus: true });
  });
  // a link to sign in or to the account page leads away from the chat
  panel.addEventListener('click', (e) => { if (e.target.closest('[data-account-view]')) hide({ animate: false }); });

  roomsEl.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-chat-room]');
    if (chip) pick(chip.dataset.chatRoom);
  });
  newer.addEventListener('click', toEnd);
  list.addEventListener('scroll', () => { if (atEnd()) newer.hidden = true; }, { passive: true });

  // ---------- writing ----------

  function setError(text) {
    errorEl.textContent = text || '';
    errorEl.hidden = !text;
  }

  // the field grows with its text, up to a few lines
  function fit() {
    area.style.height = 'auto';
    area.style.height = `${Math.min(area.scrollHeight, 120)}px`;
  }

  async function send() {
    const body = area.value.trim();
    if (!body || sendButton.getAttribute('aria-busy') === 'true') return;
    setError('');
    sendButton.setAttribute('aria-busy', 'true');
    // The field empties at once, so the next message can be typed while this
    // one is on its way; if it doesn't arrive, its text comes back.
    area.value = '';
    fit();
    const name = room;
    const r = await request('send', { body: { room: name, body } });
    sendButton.removeAttribute('aria-busy');
    if (!r.ok) {
      area.value = [body, area.value].filter(Boolean).join('\n');
      fit();
      if (r.status === 401) { you = null; guests = false; renderIdentity(); }
      return setError(r.data.message || 'Die Nachricht konnte nicht gesendet werden.');
    }
    if (r.data.you) { you = r.data.you; renderIdentity(); }
    // shown at once; the next poll brings it again (and anything written just before it) and is merged by id
    merge(roomOf(name), [r.data.message]);
    quiet = 0;
    if (name === room) render({ toEnd: true });
    schedule();
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); send(); });
  area.addEventListener('input', () => { fit(); setError(''); });
  // Enter sends, Shift+Enter starts a new line; not while an input method is composing a character
  area.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    send();
  });

  renderIdentity();

  return {
    enable() {
      enabled = true;
      root.hidden = false;
      document.body.classList.add('has-chat');
    },
    rooms,
    identityChanged,
  };
}
