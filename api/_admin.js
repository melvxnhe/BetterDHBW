// The admin area: /admin (a page) and /api/admin/<action>. For whoever runs
// the site: numbers at a glance, the chat (delete messages, stop a sender
// from writing) and the accounts (remove a display name, delete an account).
//
// - It exists only where ADMIN_PASSWORD_HASH is set; without it every
//   address here answers 404, as if there were nothing.
// - The password itself is nowhere: not in this repository, not in the
//   environment. ADMIN_PASSWORD_HASH is its scrypt hash, made by
//   `npm run admin:hash` (scripts/admin-hash.mjs).
// - Signing in is limited to 8 tries in 15 minutes per IP and 40 an hour in
//   total, so the password can't be guessed by trying.
// - An admin session is a cookie of its own (HttpOnly, Secure,
//   SameSite=Strict, 12 hours); the database keeps only its hash.
// - /admin shows the sign-in form to everyone else. The panel's markup and
//   script are only sent to a signed-in admin.
// - Every change needs JSON from this site (CSRF, see _http.js) and is
//   written to the server log, without the content it touched.

import { q, configured } from './_db.js';
import { api, reply, fail, Problem } from './_http.js';
import { newToken, startAdmin, isAdmin, endAdmin } from './_session.js';
import { limit, sweep } from './_limits.js';
import { checkPassword } from './_password.js';
import { GUESTS } from './_chat.js';
import { loginPage, panelPage } from './_admin_page.js';

const PAGE = 100; // messages per request
const USERS = 200; // accounts per request
const MINUTE = 60;

const passwordHash = () => process.env.ADMIN_PASSWORD_HASH || ''; // read per request: serve.mjs loads .env after this file

// ---------- what a request sent ----------

const ID = /^\d{1,15}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SENDER = /^[A-Za-z0-9_-]{12}$/;
const ROOM = /^(?:global|[A-Z0-9-]{1,40})$/;

// The value if it has the right shape, else the request ends with a 400.
function shaped(value, pattern) {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  if (!pattern.test(text)) throw new Problem(400, 'invalid', 'Ungültige Anfrage.');
  return text;
}

async function requireAdmin(headers) {
  if (!(await isAdmin(headers))) throw new Problem(401, 'signed-out', 'Bitte melde dich an.');
}

// what was done, for the server log: the action and ids, never names, addresses or texts
const record = (action, detail = '') => console.log('admin', action, detail);

const count = (value) => Number(value) || 0; // Postgres counts arrive as text

// ---------- the request ----------

const ACTIONS = {
  page: 'GET', login: 'POST', logout: 'POST', overview: 'GET',
  messages: 'GET', 'delete-message': 'POST', 'delete-sender': 'POST', bans: 'GET', ban: 'POST', unban: 'POST',
  users: 'GET', 'clear-name': 'POST', 'delete-user': 'POST',
};

const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'X-Robots-Tag': 'noindex, nofollow', // not for search engines
  'Referrer-Policy': 'no-referrer',
};

const ROUTES = {
  // The sign-in form, or the panel for a signed-in admin. Each answer gets a
  // fresh nonce: only the page's own style and script run (CSP in the page).
  async page({ headers }) {
    const nonce = newToken().slice(0, 24);
    return reply(200, (await isAdmin(headers)) ? panelPage(nonce) : loginPage(nonce), [], PAGE_HEADERS);
  },

  async login({ body, ip }) {
    await limit(`admin:ip:${ip}`, 8, 15 * MINUTE);
    await limit('admin:all', 40, 60 * MINUTE);
    const ok = typeof body.password === 'string' && body.password.length <= 400 && (await checkPassword(body.password, passwordHash()));
    record(ok ? 'login' : 'login-failed');
    if (!ok) return fail(401, 'wrong', 'Das Passwort stimmt nicht.');
    return reply(200, { ok: true }, [await startAdmin()]);
  },

  async logout({ headers }) {
    return reply(200, { ok: true }, [await endAdmin(headers)]);
  },

  async overview({ headers }) {
    await requireAdmin(headers);
    const [n] = await q(
      `SELECT (SELECT count(*) FROM users) AS users,
              (SELECT count(*) FROM users WHERE name IS NOT NULL) AS named,
              (SELECT count(*) FROM users WHERE created_at > now() - interval '7 days') AS new_users,
              (SELECT count(*) FROM sessions WHERE expires_at > now()) AS sessions,
              (SELECT count(*) FROM notes) AS notes,
              (SELECT count(*) FROM chat_messages) AS messages,
              (SELECT count(*) FROM chat_messages WHERE created_at > now() - interval '1 day') AS messages_day,
              (SELECT count(*) FROM chat_bans) AS bans`);
    const rooms = await q(`SELECT room, count(*) AS n, max(created_at) AS last FROM chat_messages GROUP BY room ORDER BY max(id) DESC LIMIT 50`);
    return reply(200, {
      users: count(n.users), named: count(n.named), newUsers: count(n.new_users), sessions: count(n.sessions),
      notes: count(n.notes), messages: count(n.messages), messagesDay: count(n.messages_day), bans: count(n.bans),
      rooms: rooms.map((r) => ({ room: r.room, messages: count(r.n), last: r.last })),
      settings: {
        guests: GUESTS,
        mail: process.env.RESEND_API_KEY && process.env.MAIL_FROM ? 'Resend' : process.env.SMTP_USER && process.env.SMTP_PASS ? 'SMTP' : null,
      },
    });
  },

  // ---- chat ----

  // The newest messages, of every room or of one; `before` pages back.
  async messages({ query, headers }) {
    await requireAdmin(headers);
    const room = query.room ? shaped(query.room, ROOM) : null;
    const before = query.before ? shaped(query.before, ID) : null;
    const rows = await q(
      `SELECT m.id, m.room, m.sender, m.name, m.body, m.created_at, u.email, (b.sender IS NOT NULL) AS banned
       FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id LEFT JOIN chat_bans b ON b.sender = m.sender
       WHERE ($1::text IS NULL OR m.room = $1::text) AND ($2::bigint IS NULL OR m.id < $2::bigint)
       ORDER BY m.id DESC LIMIT $3`, [room, before, PAGE]);
    return reply(200, {
      messages: rows.map((m) => ({ id: Number(m.id), room: m.room, sender: m.sender, name: m.name, email: m.email || null, banned: !!m.banned, body: m.body, at: m.created_at })),
      more: rows.length === PAGE,
    });
  },

  async 'delete-message'({ body, headers }) {
    await requireAdmin(headers);
    const id = shaped(body.id, ID);
    const gone = await q(`DELETE FROM chat_messages WHERE id = $1::bigint RETURNING id`, [id]);
    record('delete-message', id);
    return reply(200, { deleted: gone.length });
  },

  // everything one sender wrote, in every room
  async 'delete-sender'({ body, headers }) {
    await requireAdmin(headers);
    const sender = shaped(body.sender, SENDER);
    const gone = await q(`DELETE FROM chat_messages WHERE sender = $1 RETURNING id`, [sender]);
    record('delete-sender', `${sender} (${gone.length})`);
    return reply(200, { deleted: gone.length });
  },

  async bans({ headers }) {
    await requireAdmin(headers);
    const rows = await q(`SELECT sender, name, created_at FROM chat_bans ORDER BY created_at DESC LIMIT 500`);
    return reply(200, { bans: rows.map((b) => ({ sender: b.sender, name: b.name, at: b.created_at })) });
  },

  // Stops a sender from writing. For an account that holds; a guest is a
  // cookie, and gets a new number by deleting it (the IP limits still apply).
  async ban({ body, headers }) {
    await requireAdmin(headers);
    const sender = shaped(body.sender, SENDER);
    const [last] = await q(`SELECT name FROM chat_messages WHERE sender = $1 ORDER BY id DESC LIMIT 1`, [sender]);
    await q(`INSERT INTO chat_bans (sender, name) VALUES ($1, $2) ON CONFLICT (sender) DO NOTHING`, [sender, last?.name || '']);
    record('ban', sender);
    return reply(200, { ok: true });
  },

  async unban({ body, headers }) {
    await requireAdmin(headers);
    const sender = shaped(body.sender, SENDER);
    await q(`DELETE FROM chat_bans WHERE sender = $1`, [sender]);
    record('unban', sender);
    return reply(200, { ok: true });
  },

  // ---- accounts ----

  // The newest accounts, or those whose address or name contains `q`.
  async users({ query, headers }) {
    await requireAdmin(headers);
    const search = (typeof query.q === 'string' ? query.q : '').trim().slice(0, 100).replace(/[\\%_]/g, '\\$&'); // % and _ as themselves
    const rows = await q(
      `SELECT u.id, u.email, u.name, u.created_at,
              (SELECT count(*) FROM notes n WHERE n.user_id = u.id) AS notes,
              (SELECT count(*) FROM chat_messages m WHERE m.user_id = u.id) AS messages
       FROM users u
       WHERE $1::text = '' OR u.email ILIKE '%' || $1::text || '%' OR u.name ILIKE '%' || $1::text || '%'
       ORDER BY u.created_at DESC LIMIT $2`, [search, USERS]);
    return reply(200, {
      users: rows.map((u) => ({ id: u.id, email: u.email, name: u.name || null, createdAt: u.created_at, notes: count(u.notes), messages: count(u.messages) })),
      more: rows.length === USERS,
    });
  },

  // for a name that shouldn't stand: the account writes as "Nutzer 1234" again
  async 'clear-name'({ body, headers }) {
    await requireAdmin(headers);
    const id = shaped(body.id, UUID);
    const changed = await q(`UPDATE users SET name = NULL WHERE id = $1::uuid RETURNING id`, [id]);
    record('clear-name', id);
    return reply(200, { changed: changed.length });
  },

  // the account with its sessions, notes and chat messages
  async 'delete-user'({ body, headers }) {
    await requireAdmin(headers);
    const id = shaped(body.id, UUID);
    const [user] = await q(`DELETE FROM users WHERE id = $1::uuid RETURNING email`, [id]);
    if (user) await q(`DELETE FROM tokens WHERE email = $1`, [user.email]);
    record('delete-user', id);
    return reply(200, { deleted: user ? 1 : 0 });
  },
};

async function cleanup() {
  await q(`DELETE FROM admin_sessions WHERE expires_at < now()`);
  await sweep();
}

const handle = api('admin', ACTIONS, ROUTES, { ready: configured, tick: cleanup });

// Without a password hash there is no admin area: every address answers as an unknown one would.
export async function handleAdmin(request) {
  if (!passwordHash()) return request.action === 'page' ? reply(404, 'Nicht gefunden.', [], { 'Content-Type': 'text/plain; charset=utf-8' }) : fail(404, 'not-found', 'Unbekannte Aktion.');
  return handle(request);
}
