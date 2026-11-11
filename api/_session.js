// Who is asking: the signed-in user behind a session cookie, or a guest.
//
// - Sessions: 32 random bytes in an HttpOnly, Secure, SameSite=Lax cookie
//   with the __Host- prefix; the database only keeps a SHA-256 of it, so a
//   leaked table logs nobody in.
// - Guests (the chat, while it is open to people without an account) get a
//   random id in a cookie of the same kind. Nothing about them is stored
//   except what they write.
// - The admin area has sessions of its own: another cookie (SameSite=Strict,
//   so no link from elsewhere arrives signed in), another table, 12 hours.

import { createHash, randomBytes } from 'node:crypto';
import { q } from './_db.js';
import { Problem } from './_http.js';

const SESSION = '__Host-sid';
const GUEST = '__Host-gid';
const ADMIN = '__Host-aid';
const SESSION_DAYS = 30;
const ADMIN_HOURS = 12;
const GUEST_DAYS = 365;
const MAX_TOKEN = 100; // anything longer is not one of ours
const DAY = 86400;

export const sha256 = (s) => createHash('sha256').update(s).digest('base64url');
export const newToken = () => randomBytes(32).toString('base64url');

// A number from 1000 to 9999 that is always the same for the same id: "Gast 4821".
export const numberOf = (id) => 1000 + (parseInt(createHash('sha256').update(String(id)).digest('hex').slice(0, 8), 16) % 9000);

const cookie = (name, value, maxAge, sameSite = 'Lax') => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=${sameSite}; Max-Age=${maxAge}`;
export const clearSession = () => cookie(SESSION, '', 0);

// The token a request carries in the cookie `name` and its hash, or null.
function tokenOf(headers, name) {
  for (const part of String(headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k !== name) continue;
    const token = v.join('=');
    return token && token.length <= MAX_TOKEN ? { token, hash: sha256(token) } : null;
  }
  return null;
}

// ---------- sessions ----------

export const sessionOf = (headers) => tokenOf(headers, SESSION);

// Returns the Set-Cookie value that signs the browser in.
export async function startSession(userId) {
  const token = newToken();
  await q(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))`,
    [sha256(token), userId, SESSION_DAYS]);
  return cookie(SESSION, token, SESSION_DAYS * DAY);
}

// The signed-in user, or null. A session is extended (and its cookie renewed)
// at most once a day, so an active user stays signed in.
export async function currentUser(headers) {
  const session = sessionOf(headers);
  if (!session) return { user: null, cookies: [] };
  const [row] = await q(
    `SELECT u.id, u.email, u.name, u.settings, s.expires_at < now() + make_interval(days => $2) AS stale
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`, [session.hash, SESSION_DAYS - 1]);
  if (!row) return { user: null, cookies: [] };
  const cookies = [];
  if (row.stale) {
    await q(`UPDATE sessions SET expires_at = now() + make_interval(days => $2) WHERE token_hash = $1`, [session.hash, SESSION_DAYS]);
    cookies.push(cookie(SESSION, session.token, SESSION_DAYS * DAY));
  }
  return { user: { id: row.id, email: row.email, name: row.name || null, settings: row.settings || {} }, cookies, hash: session.hash };
}

export async function requireUser(headers) {
  const session = await currentUser(headers);
  if (!session.user) throw new Problem(401, 'signed-out', 'Bitte melde dich an.');
  return session;
}

// ---------- guests ----------

// The guest a request comes from: { hash }, or null if it carries no guest cookie.
export const guestOf = (headers) => tokenOf(headers, GUEST);

// A new guest: { hash, cookie }, the cookie to be sent with the answer.
export function newGuest() {
  const token = newToken();
  return { hash: sha256(token), cookie: cookie(GUEST, token, GUEST_DAYS * DAY) };
}

// ---------- the admin ----------

// Returns the Set-Cookie value that signs the browser in as admin.
export async function startAdmin() {
  const token = newToken();
  await q(`INSERT INTO admin_sessions (token_hash, expires_at) VALUES ($1, now() + make_interval(hours => $2))`, [sha256(token), ADMIN_HOURS]);
  return cookie(ADMIN, token, ADMIN_HOURS * 3600, 'Strict');
}

export async function isAdmin(headers) {
  const session = tokenOf(headers, ADMIN);
  if (!session) return false;
  const [row] = await q(`SELECT 1 AS ok FROM admin_sessions WHERE token_hash = $1 AND expires_at > now()`, [session.hash]);
  return !!row;
}

// Ends the admin session a request carries; returns the Set-Cookie value that clears it.
export async function endAdmin(headers) {
  const session = tokenOf(headers, ADMIN);
  if (session) await q(`DELETE FROM admin_sessions WHERE token_hash = $1`, [session.hash]);
  return cookie(ADMIN, '', 0, 'Strict');
}
