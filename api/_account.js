// Accounts: sign-up with a DHBW Mannheim address, login, password reset,
// synced settings and private notes per lecture. Used by the Vercel function
// api/account.js and by serve.mjs, which both turn a request into
// handleAccount({ method, action, query, body, headers, ip }) and send back
// what it returns: { status, body, cookies }.
//
// Security, in one place:
// - Passwords: scrypt (N=2^15, r=8, p=1) with a random salt, compared in
//   constant time; logins for unknown addresses spend the same time.
// - Sessions: 32 random bytes in an HttpOnly, Secure, SameSite=Lax cookie
//   with the __Host- prefix; the database only keeps a SHA-256 of it.
// - E-mail links: single use, 24 h (sign-up) or 1 h (reset), token in the
//   URL fragment so it never reaches a server log or a Referer header.
// - CSRF: changes need JSON and an Origin (or Sec-Fetch-Site) of this site.
// - No account enumeration: sign-up, reset and login answer the same whether
//   an address is registered or not; lockouts count per address hash.
// - Rate limits per IP and per address, in the database (functions are stateless).
// - Links are built from APP_URL / Vercel's production URL, never from the
//   Host header, so a forged Host can't redirect a reset link.

import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { q, configured } from './_db.js';

const scrypt = promisify(scryptCb);
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;

const COOKIE = '__Host-sid';
const SESSION_DAYS = 30;
const VERIFY_HOURS = 24;
const RESET_HOURS = 1;
const MAX_NOTES = 1000;
const MAX_NOTE = 2000;

export const ALLOWED_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS || 'student.dhbw-mannheim.de,dhbw-mannheim.de')
  .split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);

const COURSE = /^[A-Z0-9-]{1,40}$/;
const EVENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

// ---------- small helpers ----------

const sha256 = (s) => createHash('sha256').update(s).digest('base64url');
const newToken = () => randomBytes(32).toString('base64url');
const reply = (status, body, cookies = []) => ({ status, body, cookies });
const fail = (status, error, message, extra = {}) => reply(status, { error, message, ...extra });

class Problem extends Error {
  constructor(status, error, message) { super(message); Object.assign(this, { status, error }); }
}

function cookie(value, maxAge) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
const clearCookie = () => cookie('', 0);

function readCookie(header) {
  for (const part of String(header || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
  return null;
}

// ---------- passwords ----------

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, KEYLEN, SCRYPT);
  return `scrypt$15$8$1$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function checkPassword(password, stored) {
  const [alg, logN, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const key = await scrypt(password.normalize('NFKC'), Buffer.from(salt, 'base64url'), expected.length,
    { N: 2 ** Number(logN), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// a real hash to compare against when the address is unknown, so both cases take as long
let dummy = null;
const dummyHash = async () => (dummy ??= await hashPassword(newToken()));

// Is the password in a known data breach? Have I Been Pwned's range API only
// ever sees the first 5 characters of the SHA-1. If it can't be reached, the
// check is skipped rather than blocking sign-ups.
async function breached(password) {
  try {
    const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
    const res = await fetch(`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'dhbw-mannheim-stundenplan' }, signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return false;
    const suffix = sha1.slice(5);
    return (await res.text()).split('\n').some((line) => line.startsWith(suffix) && Number(line.split(':')[1]) > 0);
  } catch {
    return false;
  }
}

async function passwordProblem(password, email) {
  if (typeof password !== 'string') return 'Bitte ein Passwort eingeben.';
  const length = [...password].length;
  if (length < 10) return 'Das Passwort braucht mindestens 10 Zeichen.';
  if (length > 200) return 'Das Passwort darf höchstens 200 Zeichen haben.';
  if (email && password.trim().toLowerCase() === email) return 'Das Passwort darf nicht deine E-Mail-Adresse sein.';
  if (await breached(password)) return 'Dieses Passwort taucht in bekannten Datenlecks auf. Bitte nimm ein anderes.';
  return null;
}

// ---------- addresses ----------

function normalEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function emailProblem(email) {
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}$/.test(email)) return 'Bitte eine gültige E-Mail-Adresse eingeben.';
  const domain = email.split('@')[1];
  if (!ALLOWED_DOMAINS.includes(domain)) return `Registrieren können sich nur Adressen der DHBW Mannheim (…@${ALLOWED_DOMAINS.join(' oder …@')}).`;
  return null;
}

// ---------- rate limits ----------

// Counts a hit for `key` in a window of `seconds`; true while within `limit`.
async function hit(key, limit, seconds) {
  const [row] = await q(
    `INSERT INTO rate_limits (key, count, reset_at) VALUES ($1, 1, now() + make_interval(secs => $2))
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limits.reset_at < now() THEN 1 ELSE rate_limits.count + 1 END,
       reset_at = CASE WHEN rate_limits.reset_at < now() THEN now() + make_interval(secs => $2) ELSE rate_limits.reset_at END
     RETURNING count`, [key, seconds]);
  return row.count <= limit;
}

async function count(key) {
  const [row] = await q(`SELECT count FROM rate_limits WHERE key = $1 AND reset_at > now()`, [key]);
  return row?.count || 0;
}

const tooMany = () => fail(429, 'rate-limited', 'Zu viele Versuche. Bitte warte ein paar Minuten.');

// ---------- e-mail ----------

const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function sendMail(ctx, { to, subject, lines, link, linkLabel }) {
  const text = [...lines, '', link ? `${linkLabel}: ${link}` : '', '', 'Stundenpläne der DHBW Mannheim (inoffiziell)'].join('\n');
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#1d1d1f">${lines.map((l) => `<p>${escHtml(l)}</p>`).join('')}${link
    ? `<p><a href="${escHtml(link)}" style="display:inline-block;padding:10px 16px;border-radius:10px;background:#1d1d1f;color:#fff;text-decoration:none">${escHtml(linkLabel)}</a></p><p style="color:#6e6e73;font-size:13px">Oder diesen Link öffnen: ${escHtml(link)}</p>`
    : ''}<p style="color:#6e6e73;font-size:13px">Stundenpläne der DHBW Mannheim (inoffiziell)</p></div>`;

  if (process.env.RESEND_API_KEY && process.env.MAIL_FROM) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text, html }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Problem(502, 'mail-failed', 'Die E-Mail konnte gerade nicht verschickt werden. Bitte später noch einmal versuchen.');
    return;
  }
  // SMTP, by default Gmail: SMTP_USER is the address, SMTP_PASS a Google app password
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    const { createTransport } = await import('nodemailer');
    const port = Number(process.env.SMTP_PORT || 465);
    const transport = createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com', port, secure: port === 465, requireTLS: port !== 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS.replace(/\s+/g, '') }, // app passwords are shown with spaces
      connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 10000,
    });
    try {
      await transport.sendMail({ from: process.env.MAIL_FROM || `Stundenplan DHBW Mannheim <${process.env.SMTP_USER}>`, to, subject, text, html });
    } catch (err) {
      console.error('smtp', err.code || err.message);
      throw new Problem(502, 'mail-failed', 'Die E-Mail konnte gerade nicht verschickt werden. Bitte später noch einmal versuchen.');
    }
    return;
  }
  if (ctx.dev) {
    // local development: no mail service, the link goes to the server console
    console.log(`\n[Mail an ${to}] ${subject}\n${text}\n`);
    return;
  }
  throw new Problem(503, 'mail-not-configured', 'Der E-Mail-Versand ist noch nicht eingerichtet. Registrieren geht erst danach.');
}

// Where e-mail links point. Never derived from the request's Host header.
function appUrl(ctx) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (ctx.dev && ctx.origin) return ctx.origin;
  throw new Problem(503, 'no-app-url', 'APP_URL ist nicht gesetzt.');
}

// ---------- sessions ----------

async function startSession(userId) {
  const token = newToken();
  await q(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))`,
    [sha256(token), userId, SESSION_DAYS]);
  return cookie(token, SESSION_DAYS * 86400);
}

// The signed-in user, or null. A session is extended (and its cookie renewed)
// at most once a day, so an active user stays signed in.
async function currentUser(headers) {
  const token = readCookie(headers.cookie);
  if (!token || token.length > 100) return { user: null, cookies: [] };
  const hash = sha256(token);
  const [row] = await q(
    `SELECT u.id, u.email, u.settings, s.expires_at < now() + make_interval(days => $2) AS stale
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`, [hash, SESSION_DAYS - 1]);
  if (!row) return { user: null, cookies: [] };
  const cookies = [];
  if (row.stale) {
    await q(`UPDATE sessions SET expires_at = now() + make_interval(days => $2) WHERE token_hash = $1`, [hash, SESSION_DAYS]);
    cookies.push(cookie(token, SESSION_DAYS * 86400));
  }
  return { user: { id: row.id, email: row.email, settings: row.settings || {} }, cookies, hash };
}

// ---------- settings and notes ----------

function cleanSettings(input) {
  const out = {};
  if (input && typeof input === 'object') {
    if (typeof input.course === 'string' && COURSE.test(input.course)) out.course = input.course;
    if (Array.isArray(input.recent)) out.recent = [...new Set(input.recent.filter((c) => typeof c === 'string' && COURSE.test(c)))].slice(0, 5);
  }
  return out;
}

const noteOut = (n) => ({ course: n.course, eventId: n.event_id, eventName: n.event_name, eventStart: n.event_start, body: n.body, updatedAt: n.updated_at });

// ---------- the request ----------

// Changes must come from this site: JSON (which a plain HTML form can't send)
// and an Origin or Sec-Fetch-Site saying so.
function csrfProblem(headers) {
  if (!String(headers['content-type'] || '').toLowerCase().startsWith('application/json')) return 'JSON erwartet.';
  const host = headers['x-forwarded-host'] || headers.host;
  if (headers.origin) {
    try { if (new URL(headers.origin).host !== host) return 'Fremde Herkunft.'; } catch { return 'Fremde Herkunft.'; }
  } else if (headers['sec-fetch-site'] && !['same-origin', 'none'].includes(headers['sec-fetch-site'])) {
    return 'Fremde Herkunft.';
  }
  return null;
}

const ACTIONS = {
  me: 'GET', register: 'POST', verify: 'POST', login: 'POST', logout: 'POST', 'logout-all': 'POST',
  forgot: 'POST', reset: 'POST', password: 'POST', delete: 'POST', settings: 'PUT', notes: 'GET', note: 'PUT', export: 'GET',
};

export async function handleAccount({ method, action, query = {}, body = null, headers = {}, ip = '', ctx = {} }) {
  if (!Object.hasOwn(ACTIONS, action)) return fail(404, 'not-found', 'Unbekannte Aktion.');
  if (method !== ACTIONS[action]) return fail(405, 'method', 'Falsche Methode.');
  if (!configured()) return fail(503, 'not-configured', 'Konten sind auf diesem Server nicht eingerichtet.');
  if (method !== 'GET') {
    const problem = csrfProblem(headers);
    if (problem) return fail(403, 'forbidden', problem);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'bad-request', 'Ungültige Anfrage.');
  }

  try {
    if (Math.random() < 0.02) await cleanup();
    return await ROUTES[action]({ query, body: body || {}, headers, ip: String(ip || 'unknown').slice(0, 64), ctx });
  } catch (err) {
    if (err instanceof Problem) return fail(err.status, err.error, err.message);
    console.error('account', action, err);
    return fail(500, 'server', 'Da ist etwas schiefgegangen. Bitte später noch einmal versuchen.');
  }
}

async function cleanup() {
  await q(`DELETE FROM sessions WHERE expires_at < now()`);
  await q(`DELETE FROM tokens WHERE expires_at < now()`);
  await q(`DELETE FROM rate_limits WHERE reset_at < now() - interval '1 day'`);
}

async function requireUser(headers) {
  const session = await currentUser(headers);
  if (!session.user) throw new Problem(401, 'signed-out', 'Bitte melde dich an.');
  return session;
}

const SENT = (email) => `Wenn ${email} registriert werden kann, ist eine E-Mail unterwegs. Der Link darin gilt 24 Stunden.`;

const ROUTES = {
  async me({ headers }) {
    const { user, cookies } = await currentUser(headers);
    return reply(200, { user: user && { email: user.email }, settings: user?.settings || null }, cookies);
  },

  async register({ body, ip, ctx }) {
    const email = normalEmail(body.email);
    const problem = emailProblem(email) || (await passwordProblem(body.password, email));
    if (problem) return fail(400, 'invalid', problem);
    // counted once the input is valid: what costs (and could be abused) is the mail
    if (!(await hit(`register:ip:${ip}`, 10, 3600))) return tooMany();
    // the same answer either way: whether an address has an account stays private
    if (!(await hit(`register:mail:${sha256(email)}`, 3, 3600))) return reply(202, { ok: true, message: SENT(email) });

    // hashed in both cases, so the answer takes as long whether the address is taken or not
    const passwordHash = await hashPassword(body.password);
    const [existing] = await q(`SELECT id FROM users WHERE email = $1`, [email]);
    const app = appUrl(ctx);
    if (existing) {
      await sendMail(ctx, { to: email, subject: 'Du hast schon ein Konto', linkLabel: 'Passwort zurücksetzen', link: `${app}/?konto=vergessen`,
        lines: ['Jemand (vielleicht du) wollte sich mit dieser Adresse registrieren. Du hast aber schon ein Konto.', 'Passwort vergessen? Über den Link kannst du ein neues setzen. Warst du das nicht, kannst du die Mail ignorieren.'] });
    } else {
      // The account only comes into being when the link is opened, with the
      // password from this sign-up: a stranger who signs up with your address
      // first gets nothing unless you click their link.
      const token = newToken();
      await q(`INSERT INTO tokens (token_hash, kind, email, password_hash, expires_at) VALUES ($1, 'verify', $2, $3, now() + make_interval(hours => $4))`,
        [sha256(token), email, passwordHash, VERIFY_HOURS]);
      await sendMail(ctx, { to: email, subject: 'Bestätige dein Konto', linkLabel: 'Konto bestätigen', link: `${app}/?konto=bestaetigen#token=${token}`,
        lines: ['Willkommen! Bestätige deine Adresse, dann ist dein Konto fertig und du bist angemeldet.', 'Der Link gilt 24 Stunden. Hast du dich nicht registriert, ignoriere diese Mail einfach.'] });
    }
    return reply(202, { ok: true, message: SENT(email) });
  },

  async verify({ body, ip }) {
    if (!(await hit(`token:ip:${ip}`, 30, 3600))) return tooMany();
    if (typeof body.token !== 'string' || body.token.length > 100) return fail(400, 'invalid-token', 'Dieser Link ist ungültig.');
    const [user] = await q(
      `WITH t AS (DELETE FROM tokens WHERE token_hash = $1 AND kind = 'verify' AND expires_at > now() RETURNING email, password_hash)
       INSERT INTO users (email, password_hash) SELECT email, password_hash FROM t
       ON CONFLICT (email) DO NOTHING RETURNING id, email, settings`, [sha256(body.token)]);
    if (!user) return fail(400, 'invalid-token', 'Dieser Link ist abgelaufen oder wurde schon benutzt. Melde dich an oder registriere dich neu.');
    await q(`DELETE FROM tokens WHERE email = $1 AND kind = 'verify'`, [user.email]);
    return reply(200, { user: { email: user.email }, settings: user.settings || {} }, [await startSession(user.id)]);
  },

  async login({ body, ip }) {
    if (!(await hit(`login:ip:${ip}`, 30, 900))) return tooMany();
    const email = normalEmail(body.email);
    const password = typeof body.password === 'string' ? body.password.slice(0, 400) : '';
    const failKey = `login:fail:${sha256(email)}`;
    if ((await count(failKey)) >= 5) return fail(429, 'locked', 'Zu viele Fehlversuche für diese Adresse. Bitte in 15 Minuten noch einmal, oder setze dein Passwort zurück.');

    const [user] = email ? await q(`SELECT id, email, password_hash, settings FROM users WHERE email = $1`, [email]) : [];
    const ok = user ? await checkPassword(password, user.password_hash) : (await checkPassword(password, await dummyHash()), false);
    if (!ok) {
      await hit(failKey, 5, 900);
      return fail(401, 'wrong', 'E-Mail oder Passwort stimmt nicht. Gerade registriert? Dann zuerst den Link in der E-Mail öffnen.');
    }
    await q(`DELETE FROM rate_limits WHERE key = $1`, [failKey]);
    return reply(200, { user: { email: user.email }, settings: user.settings || {} }, [await startSession(user.id)]);
  },

  async logout({ headers }) {
    const token = readCookie(headers.cookie);
    if (token && token.length <= 100) await q(`DELETE FROM sessions WHERE token_hash = $1`, [sha256(token)]);
    return reply(200, { ok: true }, [clearCookie()]);
  },

  async 'logout-all'({ headers }) {
    const { user } = await requireUser(headers);
    await q(`DELETE FROM sessions WHERE user_id = $1`, [user.id]);
    return reply(200, { ok: true }, [clearCookie()]);
  },

  async forgot({ body, ip, ctx }) {
    if (!(await hit(`forgot:ip:${ip}`, 10, 3600))) return tooMany();
    const email = normalEmail(body.email);
    const message = `Wenn es für ${email || 'diese Adresse'} ein Konto gibt, ist eine E-Mail mit einem Link unterwegs. Er gilt eine Stunde.`;
    if (!email || !(await hit(`forgot:mail:${sha256(email)}`, 3, 3600))) return reply(202, { ok: true, message });
    const [user] = await q(`SELECT id FROM users WHERE email = $1`, [email]);
    if (user) {
      const token = newToken();
      await q(`INSERT INTO tokens (token_hash, kind, email, user_id, expires_at) VALUES ($1, 'reset', $2, $3, now() + make_interval(hours => $4))`,
        [sha256(token), email, user.id, RESET_HOURS]);
      await sendMail(ctx, { to: email, subject: 'Neues Passwort setzen', linkLabel: 'Neues Passwort setzen', link: `${appUrl(ctx)}/?konto=passwort#token=${token}`,
        lines: ['Über den Link setzt du ein neues Passwort. Danach bist du auf allen anderen Geräten abgemeldet.', 'Der Link gilt eine Stunde. Hast du das nicht angefordert, ignoriere diese Mail; dein Passwort bleibt, wie es ist.'] });
    }
    return reply(202, { ok: true, message });
  },

  async reset({ body, ip }) {
    if (!(await hit(`token:ip:${ip}`, 30, 3600))) return tooMany();
    if (typeof body.token !== 'string' || body.token.length > 100) return fail(400, 'invalid-token', 'Dieser Link ist ungültig.');
    const hash = sha256(body.token);
    const [token] = await q(`SELECT email FROM tokens WHERE token_hash = $1 AND kind = 'reset' AND expires_at > now()`, [hash]);
    if (!token) return fail(400, 'invalid-token', 'Dieser Link ist abgelaufen oder wurde schon benutzt. Fordere einfach einen neuen an.');
    const problem = await passwordProblem(body.password, token.email);
    if (problem) return fail(400, 'invalid', problem);
    // token used up, password changed and every session ended, in one statement
    const [user] = await q(
      `WITH t AS (DELETE FROM tokens WHERE token_hash = $1 AND kind = 'reset' AND expires_at > now() RETURNING user_id),
            u AS (UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id IN (SELECT user_id FROM t) RETURNING id, email, settings),
            s AS (DELETE FROM sessions WHERE user_id IN (SELECT id FROM u)),
            o AS (DELETE FROM tokens WHERE kind = 'reset' AND user_id IN (SELECT id FROM u))
       SELECT id, email, settings FROM u`, [hash, await hashPassword(body.password)]);
    if (!user) return fail(400, 'invalid-token', 'Dieser Link ist abgelaufen oder wurde schon benutzt.');
    await q(`DELETE FROM rate_limits WHERE key = $1`, [`login:fail:${sha256(user.email)}`]);
    return reply(200, { user: { email: user.email }, settings: user.settings || {} }, [await startSession(user.id)]);
  },

  async password({ body, headers }) {
    const { user, hash } = await requireUser(headers);
    if (!(await hit(`password:user:${user.id}`, 10, 3600))) return tooMany();
    const [row] = await q(`SELECT password_hash FROM users WHERE id = $1`, [user.id]);
    if (typeof body.current !== 'string' || !(await checkPassword(body.current, row.password_hash))) {
      return fail(403, 'wrong', 'Das aktuelle Passwort stimmt nicht.');
    }
    const problem = await passwordProblem(body.password, user.email);
    if (problem) return fail(400, 'invalid', problem);
    await q(`UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1`, [user.id, await hashPassword(body.password)]);
    await q(`DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2`, [user.id, hash]); // other devices are signed out
    return reply(200, { ok: true, message: 'Passwort geändert. Auf anderen Geräten bist du jetzt abgemeldet.' });
  },

  async delete({ body, headers }) {
    const { user } = await requireUser(headers);
    if (!(await hit(`delete:user:${user.id}`, 10, 3600))) return tooMany();
    const [row] = await q(`SELECT password_hash FROM users WHERE id = $1`, [user.id]);
    if (typeof body.password !== 'string' || !(await checkPassword(body.password, row.password_hash))) {
      return fail(403, 'wrong', 'Das Passwort stimmt nicht.');
    }
    await q(`DELETE FROM tokens WHERE email = $1`, [user.email]);
    await q(`DELETE FROM users WHERE id = $1`, [user.id]); // sessions, notes and reset links go with it
    return reply(200, { ok: true }, [clearCookie()]);
  },

  async settings({ body, headers }) {
    const { user, cookies } = await requireUser(headers);
    const settings = cleanSettings(body.settings);
    if (JSON.stringify(settings).length > 2000) return fail(400, 'invalid', 'Zu viele Einstellungen.');
    await q(`UPDATE users SET settings = $2::jsonb WHERE id = $1`, [user.id, JSON.stringify(settings)]);
    return reply(200, { settings }, cookies);
  },

  async notes({ query, headers }) {
    const { user, cookies } = await requireUser(headers);
    const course = typeof query.course === 'string' ? query.course.toUpperCase() : '';
    if (course && !COURSE.test(course)) return fail(400, 'invalid', 'Ungültiger Kurs.');
    const rows = course
      ? await q(`SELECT * FROM notes WHERE user_id = $1 AND course = $2 ORDER BY event_start NULLS LAST`, [user.id, course])
      : await q(`SELECT * FROM notes WHERE user_id = $1 ORDER BY event_start DESC NULLS LAST LIMIT $2`, [user.id, MAX_NOTES]);
    return reply(200, { notes: rows.map(noteOut) }, cookies);
  },

  async note({ body, headers }) {
    const { user, cookies } = await requireUser(headers);
    if (!(await hit(`note:user:${user.id}`, 300, 3600))) return tooMany();
    const course = typeof body.course === 'string' ? body.course.toUpperCase() : '';
    const eventId = typeof body.eventId === 'string' || typeof body.eventId === 'number' ? String(body.eventId) : '';
    if (!COURSE.test(course) || !EVENT_ID.test(eventId)) return fail(400, 'invalid', 'Ungültiger Termin.');
    const text = typeof body.body === 'string' ? body.body.replace(/\r\n?/g, '\n').trim() : '';
    if ([...text].length > MAX_NOTE) return fail(400, 'invalid', `Eine Notiz darf höchstens ${MAX_NOTE} Zeichen haben.`);

    if (!text) {
      await q(`DELETE FROM notes WHERE user_id = $1 AND course = $2 AND event_id = $3`, [user.id, course, eventId]);
      return reply(200, { note: null }, cookies);
    }
    const name = typeof body.eventName === 'string' ? body.eventName.slice(0, 300) : '';
    const start = typeof body.eventStart === 'string' && !Number.isNaN(Date.parse(body.eventStart)) ? new Date(body.eventStart).toISOString() : null;
    const [n] = await q(
      `INSERT INTO notes (user_id, course, event_id, event_name, event_start, body)
       SELECT $1::uuid, $2::text, $3::text, $4::text, $5::timestamptz, $6::text
       WHERE (SELECT count(*) FROM notes WHERE user_id = $1::uuid) < $7::int
          OR EXISTS (SELECT 1 FROM notes WHERE user_id = $1::uuid AND course = $2::text AND event_id = $3::text)
       ON CONFLICT (user_id, course, event_id) DO UPDATE SET body = EXCLUDED.body, event_name = EXCLUDED.event_name,
         event_start = EXCLUDED.event_start, updated_at = now()
       RETURNING *`, [user.id, course, eventId, name, start, text, MAX_NOTES]);
    if (!n) return fail(400, 'too-many', `Du hast schon ${MAX_NOTES} Notizen. Lösche erst ein paar alte.`);
    return reply(200, { note: noteOut(n) }, cookies);
  },

  // everything stored about you, as JSON (Art. 15/20 DSGVO)
  async export({ headers }) {
    const { user } = await requireUser(headers);
    const [row] = await q(`SELECT email, settings, created_at FROM users WHERE id = $1`, [user.id]);
    const notes = await q(`SELECT * FROM notes WHERE user_id = $1 ORDER BY event_start NULLS LAST`, [user.id]);
    return reply(200, { account: { email: row.email, createdAt: row.created_at, settings: row.settings }, notes: notes.map(noteOut) });
  },
};
