// End-to-end tests for the accounts, over HTTP, against serve.mjs with a
// fresh in-memory database. They try what an attacker would: other domains,
// weak passwords, forged origins, guessing, enumeration, injection, other
// people's notes, oversized and broken requests.
//
//   npm test

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { startServer, person as personAt } from './_server.mjs';

const BASE = 'http://localhost:8139';
let server;
before(async () => {
  server = await startServer(8139);
  assert.match(server.log(), /im Speicher/, 'server with an in-memory database');
});
after(() => server.stop());

const person = () => personAt(BASE);
const lastLink = (kind) => server.lastLink(kind);

const EMAIL = 'erika.musterfrau@student.dhbw-mannheim.de';
const PASSWORD = 'Kaffee und Stundenplan 2026!';
const alice = person();

test('signed out: me answers with no user', async () => {
  const r = await alice.call('me');
  assert.equal(r.status, 200);
  assert.equal(r.data.user, null);
});

test('only DHBW Mannheim addresses can register', async () => {
  for (const email of ['jemand@gmail.com', 'x@student.dhbw-mannheim.de.evil.com', 'x@dhbw-karlsruhe.de', 'x@evilstudent.dhbw-mannheim.de']) {
    const r = await alice.call('register', { email, password: PASSWORD });
    assert.equal(r.status, 400, email);
  }
});

test('weak passwords are refused: too short, the address itself, breached', async (t) => {
  assert.equal((await alice.call('register', { email: EMAIL, password: 'kurz' })).status, 400);
  assert.equal((await alice.call('register', { email: EMAIL, password: EMAIL })).status, 400);
  // The breach check asks Have I Been Pwned; when it is unreachable or slow,
  // the server lets the sign-up through by design, so the check is only
  // judged when the service answers within the server's own timeout.
  // the same request the server will make (the range of this password), so a slow range is caught here, not there
  const range = createHash('sha1').update('password1234').digest('hex').toUpperCase().slice(0, 5);
  const reachable = await fetch(`https://api.pwnedpasswords.com/range/${range}`, { headers: { 'Add-Padding': 'true', 'User-Agent': 'dhbw-mannheim-stundenplan' }, signal: AbortSignal.timeout(4000) }).then((r) => r.ok, () => false);
  if (!reachable) { t.diagnostic('Have I Been Pwned not answering within 4 s: the breached-password check was not judged'); return; }
  const breached = await alice.call('register', { email: EMAIL, password: 'password1234' });
  assert.equal(breached.status, 400, 'password1234 is in every breach list');
  assert.match(breached.data.message, /Datenlecks/);
});

test('cross-site requests are blocked (CSRF)', async () => {
  const forged = await alice.call('login', { email: EMAIL, password: PASSWORD }, { headers: { Origin: 'https://evil.example' } });
  assert.equal(forged.status, 403);
  const form = await alice.call('login', null, { method: 'POST', raw: `email=${EMAIL}`, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.equal(form.status, 403, 'an HTML form post (no JSON) is refused');
  const site = await alice.call('login', { email: EMAIL, password: PASSWORD }, { headers: { Origin: '', 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(site.status, 403);
});

test('broken and oversized requests are refused, the server stays up', async () => {
  assert.equal((await alice.call('login', null, { method: 'POST', raw: '{"email":' })).status, 400);
  assert.equal((await alice.call('login', null, { method: 'POST', raw: JSON.stringify({ email: 'x'.repeat(20000) }) })).status, 413);
  assert.equal((await alice.call('login', null, { method: 'POST', raw: '[1,2]' })).status, 400);
  assert.equal((await alice.call('nope')).status, 404);
  assert.equal((await alice.call('login')).status, 405, 'GET on a POST action');
  assert.equal((await fetch(`${BASE}/%E0`)).status, 400, 'a malformed path no longer crashes the server');
  assert.equal((await alice.call('me')).status, 200);
});

test('sign-up: the account exists only after the e-mail link', async () => {
  const r = await alice.call('register', { email: `  ${EMAIL.toUpperCase()} `, password: PASSWORD });
  assert.equal(r.status, 202);
  assert.ok(lastLink('bestaetigen'), 'a confirmation link was "sent"');
  const early = await alice.call('login', { email: EMAIL, password: PASSWORD });
  assert.equal(early.status, 401, 'no login before confirming');
});

test('confirmation links: wrong ones fail, the right one works once and signs in', async () => {
  assert.equal((await alice.call('verify', { token: 'a'.repeat(43) })).status, 400);
  const token = lastLink('bestaetigen');
  const ok = await alice.call('verify', { token });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.email, EMAIL);
  const c = ok.setCookie[0];
  for (const flag of ['__Host-sid=', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) assert.ok(c.includes(flag), `cookie has ${flag}`);
  assert.equal((await person().call('verify', { token })).status, 400, 'single use');
  assert.equal((await alice.call('me')).data.user.email, EMAIL);
});

test('no account enumeration: registering a taken address looks the same', async () => {
  const taken = await person().call('register', { email: EMAIL, password: 'Ein anderes langes Passwort 1' });
  const fresh = await person().call('register', { email: 'max.neu@student.dhbw-mannheim.de', password: 'Ein anderes langes Passwort 1' });
  assert.equal(taken.status, fresh.status);
  assert.equal(taken.data.message.replace(EMAIL, '@'), fresh.data.message.replace('max.neu@student.dhbw-mannheim.de', '@'));
  assert.match(server.log(), /Du hast schon ein Konto/, 'the owner is told by mail instead');
});

test('a stranger signing up with your address gets nothing', async () => {
  // their sign-up mail goes to you; until you click it, their password is useless
  const mallory = person();
  await mallory.call('register', { email: 'opfer@student.dhbw-mannheim.de', password: 'Mallorys geheimes Passwort 9' });
  assert.equal((await mallory.call('login', { email: 'opfer@student.dhbw-mannheim.de', password: 'Mallorys geheimes Passwort 9' })).status, 401);
});

test('wrong logins: same answer for unknown addresses, lockout after 5', async () => {
  const known = await person().call('login', { email: EMAIL, password: 'falsch falsch falsch' });
  const unknown = await person().call('login', { email: 'niemand@student.dhbw-mannheim.de', password: 'falsch falsch falsch' });
  assert.equal(known.status, 401);
  assert.deepEqual(known.data, unknown.data, 'identical message');
  for (let i = 0; i < 4; i++) await person().call('login', { email: EMAIL, password: `falsch ${i}` });
  const locked = await person().call('login', { email: EMAIL, password: PASSWORD });
  assert.equal(locked.status, 429, 'locked even with the right password');
  for (let i = 0; i < 5; i++) await person().call('login', { email: 'niemand@student.dhbw-mannheim.de', password: `falsch ${i}` });
  assert.equal((await person().call('login', { email: 'niemand@student.dhbw-mannheim.de', password: 'x' })).status, 429, 'unknown addresses lock the same way');
});

test('SQL injection goes nowhere', async () => {
  const r = await person().call('login', { email: "' OR 1=1 --@student.dhbw-mannheim.de", password: "' OR '1'='1" });
  assert.equal(r.status, 401);
  const n = await alice.call('note', { course: "WWI26SEA'; DROP TABLE users;--", eventId: '1', body: 'x' }, { method: 'PUT' });
  assert.equal(n.status, 400);
  const id = await alice.call('note', { course: 'WWI26SEA', eventId: "1' OR '1'='1", body: 'x' }, { method: 'PUT' });
  assert.equal(id.status, 400);
  assert.equal((await alice.call('me')).data.user.email, EMAIL, 'users table still there');
});

test('notes: saved, private per user, limited, deletable', async () => {
  const xss = '<img src=x onerror=alert(1)> Hausaufgabe: Blatt 3';
  const saved = await alice.call('note', { course: 'WWI26SEA', eventId: '2303250', eventName: 'Mathe', eventStart: '2026-11-06T08:00:00Z', body: xss }, { method: 'PUT' });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.note.body, xss, 'stored as plain text (the page renders it as text)');
  assert.equal((await alice.call('note', { course: 'WWI26SEA', eventId: '1', body: 'x'.repeat(2001) }, { method: 'PUT' })).status, 400);

  // a second account can't see or change Alice's note
  const bob = person();
  await bob.call('register', { email: 'bob@student.dhbw-mannheim.de', password: 'Bobs ziemlich langes Passwort' });
  await bob.call('verify', { token: lastLink('bestaetigen') });
  assert.deepEqual((await bob.call('notes', null, { method: 'GET' })).data.notes, []);
  await bob.call('note', { course: 'WWI26SEA', eventId: '2303250', body: 'Bobs Notiz' }, { method: 'PUT' });
  const mine = (await alice.call('notes')).data.notes;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].body, xss, "Bob's write didn't touch Alice's note");

  assert.equal((await person().call('notes')).status, 401, 'signed out: no notes');
  await alice.call('note', { course: 'WWI26SEA', eventId: '2303250', body: '   ' }, { method: 'PUT' });
  assert.equal((await alice.call('notes')).data.notes.length, 0, 'an empty note deletes it');
});

test('settings sync keeps only valid course names', async () => {
  const r = await alice.call('settings', { settings: { course: 'WWI26SEA', recent: ['WWI26SEA', '<script>', 'TINF25CS1', 'WWI26SEA'], admin: true } }, { method: 'PUT' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.settings, { course: 'WWI26SEA', recent: ['WWI26SEA', 'TINF25CS1'] });
});

test('password reset: same answer for unknown addresses, link works once, signs out everywhere', async () => {
  const laptop = person();
  laptop.cookie = alice.cookie; // the same account on a second device
  const unknown = await person().call('forgot', { email: 'niemand2@student.dhbw-mannheim.de' });
  const known = await person().call('forgot', { email: EMAIL });
  assert.equal(unknown.status, known.status);
  const token = lastLink('passwort');
  assert.ok(token);
  assert.equal((await person().call('reset', { token, password: 'kurz' })).status, 400, 'weak password refused, link still valid');
  const phone = person();
  const ok = await phone.call('reset', { token, password: 'Mein neues sicheres Passwort 7' });
  assert.equal(ok.status, 200);
  assert.equal((await person().call('reset', { token, password: 'Noch ein anderes Passwort 8' })).status, 400, 'single use');
  assert.equal((await laptop.call('me')).data.user, null, 'the other device is signed out');
  assert.equal((await person().call('login', { email: EMAIL, password: PASSWORD })).status, 401, 'old password gone');
  alice.cookie = phone.cookie;
});

test('logout ends the session for good', async () => {
  const copy = alice.cookie;
  await alice.call('logout', {});
  const stolen = person();
  stolen.cookie = copy;
  assert.equal((await stolen.call('me')).data.user, null, 'a copied cookie is worthless after logout');
});

test('deleting the account removes everything', async () => {
  const eve = person();
  await eve.call('register', { email: 'eve@dhbw-mannheim.de', password: 'Eves langes Passwort hier' });
  await eve.call('verify', { token: lastLink('bestaetigen') });
  await eve.call('note', { course: 'WWI26SEA', eventId: '5', body: 'weg damit' }, { method: 'PUT' });
  assert.equal((await eve.call('delete', { password: 'falsch' })).status, 403);
  const before = eve.cookie;
  assert.equal((await eve.call('delete', { password: 'Eves langes Passwort hier' })).status, 200);
  const again = person();
  again.cookie = before;
  assert.equal((await again.call('notes')).status, 401);
  assert.equal((await person().call('login', { email: 'eve@dhbw-mannheim.de', password: 'Eves langes Passwort hier' })).status, 401);
});

test('sign-ups from one address are limited (10 an hour), invalid tries cost nothing', async () => {
  let last;
  for (let i = 0; i < 6; i++) {
    last = await person().call('register', { email: `spam${i}@student.dhbw-mannheim.de`, password: 'Ein brauchbares Passwort 42' });
  }
  assert.equal(last.status, 429, 'the 11th valid sign-up from this IP within the hour');
  assert.equal((await person().call('register', { email: 'x@gmail.com', password: 'Ein brauchbares Passwort 42' })).status, 400, 'invalid input still gets its real answer');
});

test('pages carry the security headers', async () => {
  const res = await fetch(`${BASE}/`);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const html = await res.text();
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'sha256-/);
  const api = await fetch(`${BASE}/api/account/me`);
  assert.equal(api.headers.get('cache-control'), 'no-store');
});

test('without ADMIN_PASSWORD_HASH there is no admin area at all', async () => {
  assert.equal((await fetch(`${BASE}/admin`)).status, 404);
  assert.equal((await person().admin('login', { password: 'egal was hier steht' })).status, 404);
  assert.equal((await person().admin('overview')).status, 404);
});
