// The chat: one room for everyone ("global") and one per course. Used by the
// Vercel function api/chat.js and by serve.mjs, like the accounts.
//
//   GET  /api/chat/messages?room=R[&after=ID]   the newest messages, or those after ID
//   GET  /api/chat/me                           who you are in the chat
//   POST /api/chat/send  { room, body }         write a message
//
// - Who writes: a signed-in user under their display name (set through
//   /api/account/name), or "Nutzer 1234" until they pick one. While
//   CHAT_GUESTS is not "off", people without an account write as "Gast 1234",
//   the number tied to a random id in an HttpOnly cookie. Those two prefixes
//   can't be chosen as names, so a guest can't pose as a user.
// - Messages are plain text, at most 500 characters; the page shows them as
//   text, never as HTML. Control and invisible direction characters are removed.
// - Sending needs JSON from this site (CSRF) and is rate-limited per sender
//   and per IP. Reading is open, carries nothing about the reader, and may
//   be cached for two seconds, so many readers polling a room cost one query.
// - Messages go after 30 days; deleting an account deletes its messages. An
//   admin can delete messages and stop a sender from writing (_admin.js).

import { q, configured } from './_db.js';
import { api, reply, fail, Problem } from './_http.js';
import { sha256, numberOf, currentUser, guestOf, newGuest } from './_session.js';
import { limit } from './_limits.js';

export const GUESTS = String(process.env.CHAT_GUESTS || '').toLowerCase() !== 'off';
const GLOBAL = 'global';
const COURSE = /^[A-Z0-9-]{1,40}$/; // upper case, so no course can be called "global"
const MAX_MESSAGE = 500;
const NEWEST = 50;  // how many messages a room opens with
const PAGE = 100;   // how many a poll returns at most
const KEEP_DAYS = 30;
const MINUTE = 60;
const SLOW_DOWN = 'Du schreibst gerade sehr schnell. Bitte warte einen Moment.';

// ---------- who is writing ----------

// The id other people see instead of a user id or a guest cookie: enough to
// tell that two messages are from the same person, nothing more.
const publicId = (kind, id) => sha256(`chat:${kind}:${id}`).slice(0, 12);

// { id, name, guest, named, userId, cookies }, or null for a visitor who is
// neither signed in nor (yet) a guest. `create` makes them a guest.
async function sender(headers, { create = false } = {}) {
  const { user, cookies } = await currentUser(headers);
  if (user) return { id: publicId('user', user.id), userId: user.id, name: user.name || `Nutzer ${numberOf(user.id)}`, named: !!user.name, guest: false, cookies };
  if (!GUESTS) return null;
  const known = guestOf(headers);
  const guest = known || (create ? newGuest() : null);
  if (!guest) return null;
  return { id: publicId('guest', guest.hash), userId: null, name: `Gast ${numberOf(guest.hash)}`, named: false, guest: true, cookies: known ? [] : [guest.cookie] };
}

const you = (from) => from && { id: from.id, name: from.name, guest: from.guest, named: from.named };

// ---------- messages ----------

function roomOf(value) {
  const room = typeof value === 'string' ? value : '';
  if (room !== GLOBAL && !COURSE.test(room)) throw new Problem(400, 'invalid', 'Diesen Chat gibt es nicht.');
  return room;
}

// Plain text: line ends unified, no control characters, no invisible or
// direction-switching characters (they can make a message read as something
// it isn't), at most one empty line in a row.
function cleanMessage(value) {
  const body = (typeof value === 'string' ? value : '')
    .replace(/\r\n?/g, '\n')
    .replace(/(?![\n\p{Join_Control}])[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '') // joiners stay: emoji and some scripts need them
    .replace(/[^\S\n]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!body) throw new Problem(400, 'invalid', 'Die Nachricht ist leer.');
  if ([...body].length > MAX_MESSAGE) throw new Problem(400, 'invalid', `Eine Nachricht darf höchstens ${MAX_MESSAGE} Zeichen haben.`);
  return body;
}

const messageOut = (m) => ({ id: Number(m.id), from: m.sender, name: m.name, guest: !m.user_id, body: m.body, at: m.created_at });

const cleanup = () => q(`DELETE FROM chat_messages WHERE created_at < now() - make_interval(days => $1)`, [KEEP_DAYS]);

// ---------- the request ----------

const ACTIONS = { messages: 'GET', me: 'GET', send: 'POST' };

const ROUTES = {
  // Nothing in the answer depends on who asks, so Vercel's edge may hand the
  // same answer to everyone polling this room for two seconds.
  async messages({ query }) {
    const room = roomOf(query.room);
    const after = query.after === undefined ? null : String(query.after);
    if (after !== null && !/^\d{1,15}$/.test(after)) return fail(400, 'invalid', 'Ungültige Anfrage.');
    const rows = after === null
      ? (await q(`SELECT * FROM chat_messages WHERE room = $1 ORDER BY id DESC LIMIT $2`, [room, NEWEST])).reverse()
      : await q(`SELECT * FROM chat_messages WHERE room = $1 AND id > $2::bigint ORDER BY id LIMIT $3`, [room, after, PAGE]);
    return reply(200, { room, messages: rows.map(messageOut) }, [], { 'Cache-Control': 'public, max-age=0, s-maxage=2' });
  },

  // Who you are in the chat. A visitor without an account becomes a guest
  // here, so the page can say "Du schreibst als Gast 4821" before the first message.
  async me({ headers }) {
    const from = await sender(headers, { create: true });
    return reply(200, { you: you(from), guests: GUESTS, max: MAX_MESSAGE }, from?.cookies || []);
  },

  async send({ body, headers, ip }) {
    const room = roomOf(body.room);
    const text = cleanMessage(body.body);
    const from = await sender(headers, { create: true });
    if (!from) return fail(401, 'signed-out', 'Bitte melde dich an, um zu schreiben.');
    const [banned] = await q(`SELECT 1 AS yes FROM chat_bans WHERE sender = $1`, [from.id]);
    if (banned) return fail(403, 'banned', 'Du kannst hier gerade nicht schreiben.');
    await limit(`chat:from:${from.id}`, 10, MINUTE, SLOW_DOWN);
    await limit(`chat:ip:${ip}`, 30, MINUTE, SLOW_DOWN);
    await limit(`chat:ip-hour:${ip}`, 300, 60 * MINUTE, SLOW_DOWN);
    const [saved] = await q(
      `INSERT INTO chat_messages (room, user_id, sender, name, body) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [room, from.userId, from.id, from.name, text]);
    return reply(200, { message: messageOut(saved), you: you(from) }, from.cookies);
  },
};

export const handleChat = api('chat', ACTIONS, ROUTES, { ready: configured, tick: cleanup });
