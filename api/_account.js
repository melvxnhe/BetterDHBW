// Accounts: sign-up with a DHBW Mannheim address, login, password reset,
// synced settings and private notes per lecture. Used by the Vercel function
// api/account.js and by serve.mjs, which both turn a request into
// handleAccount({ method, action, query, body, headers, ip }) and send back
// what it returns: { status, body, cookies }.
//
// Security, in one place:
// - Passwords (_password.js): scrypt with a random salt, compared in constant
//   time; logins for unknown addresses spend the same time.
// - Sessions (_session.js): 32 random bytes in an HttpOnly, Secure,
//   SameSite=Lax cookie with the __Host- prefix; the database only keeps a
//   SHA-256 of it.
// - E-mail links (_mail.js): single use, 24 h (sign-up) or 1 h (reset), token
//   in the URL fragment so it never reaches a server log or a Referer header.
// - CSRF (_http.js): changes need JSON and an Origin (or Sec-Fetch-Site) of this site.
// - No account enumeration: sign-up, reset and login answer the same whether
//   an address is registered or not; lockouts count per address hash.
// - Rate limits (_limits.js) per IP and per address, in the database.
// - Links are built from APP_URL / Vercel's production URL, never from the
//   Host header, so a forged Host can't redirect a reset link.

import { q, configured } from './_db.js';
import { api, reply, fail, Problem } from './_http.js';
import { sha256, newToken, sessionOf, startSession, clearSession, currentUser, requireUser } from './_session.js';
import { hit, limit, hits, forget, sweep } from './_limits.js';
import { hashPassword, checkPassword, checkLogin, passwordProblem } from './_password.js';
import { sendMail, appUrl, MAILS } from './_mail.js';

const VERIFY_HOURS = 24;
const RESET_HOURS = 1;
const MAX_NOTES = 1000;
const MAX_NOTE = 2000;
const MAX_TOKEN = 100; // anything longer is not one of ours
const HOUR = 3600;
const LOCKOUT = 15 * 60;

const ALLOWED_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS || 'student.dhbw-mannheim.de,dhbw-mannheim.de')
  .split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);

const COURSE = /^[A-Z0-9-]{1,40}$/;
const EVENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

// ---------- what a request sent ----------

const text = (value) => (typeof value === 'string' ? value : '');
const normalEmail = (value) => text(value).trim().toLowerCase();
const courseOf = (value) => text(value).toUpperCase();

function emailProblem(email) {
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}$/.test(email)) return 'Bitte eine gültige E-Mail-Adresse eingeben.';
  const domain = email.split('@')[1];
  if (!ALLOWED_DOMAINS.includes(domain)) return `Registrieren können sich nur Adressen der DHBW Mannheim (…@${ALLOWED_DOMAINS.join(' oder …@')}).`;
  return null;
}

// A display name, shown in the chat instead of the address. Letters, digits
// and . _ - with single spaces between; "Gast …" and "Nutzer …" are what
// people without a name are called, so nobody may pick those.
function cleanName(value) {
  const name = text(value).normalize('NFKC').replace(/\s+/g, ' ').trim();
  if ([...name].length < 2 || [...name].length > 24) throw new Problem(400, 'invalid', 'Der Name braucht 2 bis 24 Zeichen.');
  if (!/^[\p{L}\p{N}._-]+(?: [\p{L}\p{N}._-]+)*$/u.test(name)) throw new Problem(400, 'invalid', 'Im Namen gehen Buchstaben, Ziffern, Leerzeichen und . _ -');
  if (/^(gast|nutzer)\b/i.test(name)) throw new Problem(400, 'invalid', 'Namen, die mit „Gast“ oder „Nutzer“ anfangen, sind vergeben.');
  return name;
}

// what the page is told about the signed-in user
const publicUser = (user) => ({ email: user.email, name: user.name || null });

// Ends the request with a 400 when a check found something to say.
function valid(problem) {
  if (problem) throw new Problem(400, 'invalid', problem);
}

// The hash of the token from an e-mail link.
function linkHash(body) {
  if (typeof body.token !== 'string' || body.token.length > MAX_TOKEN) throw new Problem(400, 'invalid-token', 'Dieser Link ist ungültig.');
  return sha256(body.token);
}

function cleanSettings(input) {
  const out = {};
  if (input && typeof input === 'object') {
    if (typeof input.course === 'string' && COURSE.test(input.course)) out.course = input.course;
    if (Array.isArray(input.recent)) out.recent = [...new Set(input.recent.filter((c) => typeof c === 'string' && COURSE.test(c)))].slice(0, 5);
  }
  return out;
}

// ---------- signing in ----------

// failed logins count per address (hashed), so guessing locks the address, not the guesser's IP
const failedLogins = (email) => `login:fail:${sha256(email)}`;

// The answer to everything that signs someone in: who they are, their
// settings, and a fresh session.
const signedIn = async (user) => reply(200, { user: publicUser(user), settings: user.settings || {} }, [await startSession(user.id)]);

// Changing the password and deleting the account ask for the password again.
async function confirmPassword(user, password, message) {
  const [row] = await q(`SELECT password_hash FROM users WHERE id = $1`, [user.id]);
  if (typeof password !== 'string' || !(await checkPassword(password, row.password_hash))) throw new Problem(403, 'wrong', message);
}

// ---------- the request ----------

const ACTIONS = {
  me: 'GET', register: 'POST', verify: 'POST', login: 'POST', logout: 'POST', 'logout-all': 'POST',
  forgot: 'POST', reset: 'POST', password: 'POST', delete: 'POST', name: 'POST', settings: 'PUT', notes: 'GET', note: 'PUT', export: 'GET',
};

// what has expired
async function cleanup() {
  await q(`DELETE FROM sessions WHERE expires_at < now()`);
  await q(`DELETE FROM tokens WHERE expires_at < now()`);
  await sweep();
}

const noteOut = (n) => ({ course: n.course, eventId: n.event_id, eventName: n.event_name, eventStart: n.event_start, body: n.body, updatedAt: n.updated_at });

const ROUTES = {
  async me({ headers }) {
    const { user, cookies } = await currentUser(headers);
    return reply(200, { user: user && publicUser(user), settings: user?.settings || null }, cookies);
  },

  async register({ body, ip, ctx }) {
    const email = normalEmail(body.email);
    valid(emailProblem(email) || (await passwordProblem(body.password, email)));
    // the same answer either way: whether an address has an account stays private
    const sent = reply(202, { ok: true, message: `Wenn ${email} registriert werden kann, ist eine E-Mail unterwegs. Der Link darin gilt 24 Stunden.` });
    // counted once the input is valid: what costs (and could be abused) is the mail
    await limit(`register:ip:${ip}`, 10);
    if (!(await hit(`register:mail:${sha256(email)}`, 3, HOUR))) return sent;

    // hashed in both cases, so the answer takes as long whether the address is taken or not
    const passwordHash = await hashPassword(body.password);
    const [existing] = await q(`SELECT id FROM users WHERE email = $1`, [email]);
    const app = appUrl(ctx);
    if (existing) {
      await sendMail(ctx, email, MAILS.taken(app));
      return sent;
    }
    // The account only comes into being when the link is opened, with the
    // password from this sign-up: a stranger who signs up with your address
    // first gets nothing unless you click their link.
    const token = newToken();
    await q(`INSERT INTO tokens (token_hash, kind, email, password_hash, expires_at) VALUES ($1, 'verify', $2, $3, now() + make_interval(hours => $4))`,
      [sha256(token), email, passwordHash, VERIFY_HOURS]);
    await sendMail(ctx, email, MAILS.verify(app, token));
    return sent;
  },

  async verify({ body, ip }) {
    await limit(`token:ip:${ip}`, 30);
    const [user] = await q(
      `WITH t AS (DELETE FROM tokens WHERE token_hash = $1 AND kind = 'verify' AND expires_at > now() RETURNING email, password_hash)
       INSERT INTO users (email, password_hash) SELECT email, password_hash FROM t
       ON CONFLICT (email) DO NOTHING RETURNING id, email, name, settings`, [linkHash(body)]);
    if (!user) return fail(400, 'invalid-token', 'Dieser Link ist abgelaufen oder wurde schon benutzt. Melde dich an oder registriere dich neu.');
    await q(`DELETE FROM tokens WHERE email = $1 AND kind = 'verify'`, [user.email]);
    return signedIn(user);
  },

  async login({ body, ip }) {
    await limit(`login:ip:${ip}`, 30, LOCKOUT);
    const email = normalEmail(body.email);
    const password = text(body.password).slice(0, 400);
    const failed = failedLogins(email);
    if ((await hits(failed)) >= 5) return fail(429, 'locked', 'Zu viele Fehlversuche für diese Adresse. Bitte in 15 Minuten noch einmal, oder setze dein Passwort zurück.');

    const [user] = email ? await q(`SELECT id, email, name, password_hash, settings FROM users WHERE email = $1`, [email]) : [];
    if (!(await checkLogin(password, user?.password_hash))) {
      await hit(failed, 5, LOCKOUT);
      return fail(401, 'wrong', 'E-Mail oder Passwort stimmt nicht. Gerade registriert? Dann zuerst den Link in der E-Mail öffnen.');
    }
    await forget(failed);
    return signedIn(user);
  },

  async logout({ headers }) {
    const session = sessionOf(headers);
    if (session) await q(`DELETE FROM sessions WHERE token_hash = $1`, [session.hash]);
    return reply(200, { ok: true }, [clearSession()]);
  },

  async 'logout-all'({ headers }) {
    const { user } = await requireUser(headers);
    await q(`DELETE FROM sessions WHERE user_id = $1`, [user.id]);
    return reply(200, { ok: true }, [clearSession()]);
  },

  async forgot({ body, ip, ctx }) {
    await limit(`forgot:ip:${ip}`, 10);
    const email = normalEmail(body.email);
    const sent = reply(202, { ok: true, message: `Wenn es für ${email || 'diese Adresse'} ein Konto gibt, ist eine E-Mail mit einem Link unterwegs. Er gilt eine Stunde.` });
    if (!email || !(await hit(`forgot:mail:${sha256(email)}`, 3, HOUR))) return sent;
    const [user] = await q(`SELECT id FROM users WHERE email = $1`, [email]);
    if (user) {
      const token = newToken();
      await q(`INSERT INTO tokens (token_hash, kind, email, user_id, expires_at) VALUES ($1, 'reset', $2, $3, now() + make_interval(hours => $4))`,
        [sha256(token), email, user.id, RESET_HOURS]);
      await sendMail(ctx, email, MAILS.reset(appUrl(ctx), token));
    }
    return sent;
  },

  async reset({ body, ip }) {
    await limit(`token:ip:${ip}`, 30);
    const hash = linkHash(body);
    const [token] = await q(`SELECT email FROM tokens WHERE token_hash = $1 AND kind = 'reset' AND expires_at > now()`, [hash]);
    if (!token) return fail(400, 'invalid-token', 'Dieser Link ist abgelaufen oder wurde schon benutzt. Fordere einfach einen neuen an.');
    valid(await passwordProblem(body.password, token.email));
    // token used up, password changed and every session ended, in one statement
    const [user] = await q(
      `WITH t AS (DELETE FROM tokens WHERE token_hash = $1 AND kind = 'reset' AND expires_at > now() RETURNING user_id),
            u AS (UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id IN (SELECT user_id FROM t) RETURNING id, email, name, settings),
            s AS (DELETE FROM sessions WHERE user_id IN (SELECT id FROM u)),
            o AS (DELETE FROM tokens WHERE kind = 'reset' AND user_id IN (SELECT id FROM u))
       SELECT id, email, name, settings FROM u`, [hash, await hashPassword(body.password)]);
    if (!user) return fail(400, 'invalid-token', 'Dieser Link ist abgelaufen oder wurde schon benutzt.');
    await forget(failedLogins(user.email));
    return signedIn(user);
  },

  async password({ body, headers }) {
    const { user, hash } = await requireUser(headers);
    await limit(`password:user:${user.id}`, 10);
    await confirmPassword(user, body.current, 'Das aktuelle Passwort stimmt nicht.');
    valid(await passwordProblem(body.password, user.email));
    await q(`UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1`, [user.id, await hashPassword(body.password)]);
    await q(`DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2`, [user.id, hash]); // other devices are signed out
    return reply(200, { ok: true, message: 'Passwort geändert. Auf anderen Geräten bist du jetzt abgemeldet.' });
  },

  async delete({ body, headers }) {
    const { user } = await requireUser(headers);
    await limit(`delete:user:${user.id}`, 10);
    await confirmPassword(user, body.password, 'Das Passwort stimmt nicht.');
    await q(`DELETE FROM tokens WHERE email = $1`, [user.email]);
    await q(`DELETE FROM users WHERE id = $1`, [user.id]); // sessions, notes and reset links go with it
    return reply(200, { ok: true }, [clearSession()]);
  },

  // the name shown in the chat; unique, so nobody can pose as someone else
  async name({ body, headers }) {
    const { user, cookies } = await requireUser(headers);
    await limit(`name:user:${user.id}`, 10);
    const name = cleanName(body.name);
    const [saved] = await q(
      `UPDATE users SET name = $2 WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM users WHERE lower(name) = lower($2) AND id <> $1) RETURNING name`,
      [user.id, name]);
    if (!saved) return fail(409, 'taken', 'Diesen Namen hat schon jemand. Bitte nimm einen anderen.');
    return reply(200, { user: publicUser({ ...user, name: saved.name }) }, cookies);
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
    const course = courseOf(query.course);
    if (course && !COURSE.test(course)) return fail(400, 'invalid', 'Ungültiger Kurs.');
    const rows = course
      ? await q(`SELECT * FROM notes WHERE user_id = $1 AND course = $2 ORDER BY event_start NULLS LAST`, [user.id, course])
      : await q(`SELECT * FROM notes WHERE user_id = $1 ORDER BY event_start DESC NULLS LAST LIMIT $2`, [user.id, MAX_NOTES]);
    return reply(200, { notes: rows.map(noteOut) }, cookies);
  },

  // one note per lecture; saving an empty one deletes it
  async note({ body, headers }) {
    const { user, cookies } = await requireUser(headers);
    await limit(`note:user:${user.id}`, 300);
    const course = courseOf(body.course);
    const eventId = typeof body.eventId === 'string' || typeof body.eventId === 'number' ? String(body.eventId) : '';
    if (!COURSE.test(course) || !EVENT_ID.test(eventId)) return fail(400, 'invalid', 'Ungültiger Termin.');
    const note = text(body.body).replace(/\r\n?/g, '\n').trim();
    if ([...note].length > MAX_NOTE) return fail(400, 'invalid', `Eine Notiz darf höchstens ${MAX_NOTE} Zeichen haben.`);

    if (!note) {
      await q(`DELETE FROM notes WHERE user_id = $1 AND course = $2 AND event_id = $3`, [user.id, course, eventId]);
      return reply(200, { note: null }, cookies);
    }
    const name = text(body.eventName).slice(0, 300);
    const start = typeof body.eventStart === 'string' && !Number.isNaN(Date.parse(body.eventStart)) ? new Date(body.eventStart).toISOString() : null;
    // a new note only while the person is under the limit; an existing one can always be changed
    const [saved] = await q(
      `INSERT INTO notes (user_id, course, event_id, event_name, event_start, body)
       SELECT $1::uuid, $2::text, $3::text, $4::text, $5::timestamptz, $6::text
       WHERE (SELECT count(*) FROM notes WHERE user_id = $1::uuid) < $7::int
          OR EXISTS (SELECT 1 FROM notes WHERE user_id = $1::uuid AND course = $2::text AND event_id = $3::text)
       ON CONFLICT (user_id, course, event_id) DO UPDATE SET body = EXCLUDED.body, event_name = EXCLUDED.event_name,
         event_start = EXCLUDED.event_start, updated_at = now()
       RETURNING *`, [user.id, course, eventId, name, start, note, MAX_NOTES]);
    if (!saved) return fail(400, 'too-many', `Du hast schon ${MAX_NOTES} Notizen. Lösche erst ein paar alte.`);
    return reply(200, { note: noteOut(saved) }, cookies);
  },

  // everything stored about you, as JSON (Art. 15/20 DSGVO)
  async export({ headers }) {
    const { user } = await requireUser(headers);
    const [row] = await q(`SELECT email, name, settings, created_at FROM users WHERE id = $1`, [user.id]);
    const notes = await q(`SELECT * FROM notes WHERE user_id = $1 ORDER BY event_start NULLS LAST`, [user.id]);
    const chat = await q(`SELECT room, name, body, created_at FROM chat_messages WHERE user_id = $1 ORDER BY id`, [user.id]);
    return reply(200, {
      account: { email: row.email, name: row.name, createdAt: row.created_at, settings: row.settings },
      notes: notes.map(noteOut),
      chat: chat.map((m) => ({ room: m.room, name: m.name, body: m.body, at: m.created_at })),
    });
  },
};

export const handleAccount = api('account', ACTIONS, ROUTES, { ready: configured, tick: cleanup });
