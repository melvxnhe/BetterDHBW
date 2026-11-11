// End-to-end tests for the admin area, over HTTP, against serve.mjs with a
// fresh in-memory database and a test password: nothing without signing in,
// no guessing, no forged origins, and that deleting and banning do what
// they say.
//
//   npm test

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, person as personAt } from './_server.mjs';
import { hashPassword } from '../api/_password.js';

const BASE = 'http://localhost:8141';
const PASSWORD = 'Nur ein Test-Passwort 2026'; // for this test server only
let server;
before(async () => { server = await startServer(8141, { ADMIN_PASSWORD_HASH: await hashPassword(PASSWORD) }); });
after(() => server.stop());

const person = () => personAt(BASE);
const page = async (who) => { const r = await who.admin('page'); return { status: r.status, html: r.text, headers: r.headers }; };
const say = (who, room, body) => who.chat('send', { room, body });

async function account(email, name) {
  const who = person();
  await who.call('register', { email, password: 'Ein langes Testpasswort 2026' });
  await who.call('verify', { token: server.lastLink('bestaetigen') });
  if (name) await who.call('name', { name });
  return who;
}

const admin = person();

test('without signing in there is only the sign-in form, and nothing of the panel', async () => {
  const p = await page(person());
  assert.equal(p.status, 200);
  assert.match(p.html, /Adminbereich/);
  assert.ok(!p.html.includes('data-view'), 'no panel markup');
  assert.ok(!p.html.includes('delete-user'), 'no panel script');
  assert.match(p.headers.get('x-robots-tag'), /noindex/);
  assert.equal(p.headers.get('cache-control'), 'no-store');
  assert.match(p.html, /script-src 'nonce-[A-Za-z0-9_-]{24}'/, 'only the page’s own script may run');

  assert.match(await (await fetch(`${BASE}/admin`)).text(), /Adminbereich/, 'the form is what /admin shows');

  for (const action of ['overview', 'messages', 'users', 'bans']) assert.equal((await person().admin(action)).status, 401, action);
  for (const [action, body] of [['delete-message', { id: 1 }], ['delete-sender', { sender: 'a'.repeat(12) }], ['ban', { sender: 'a'.repeat(12) }], ['unban', { sender: 'a'.repeat(12) }],
    ['clear-name', { id: '00000000-0000-0000-0000-000000000000' }], ['delete-user', { id: '00000000-0000-0000-0000-000000000000' }]]) {
    assert.equal((await person().admin(action, body)).status, 401, action);
  }
});

test('a wrong password does not sign in; a user session is no admin session', async () => {
  for (const password of ['falsch', '', PASSWORD.toLowerCase(), `${PASSWORD} `, ['x'], 'x'.repeat(500)]) {
    const r = await person().admin('login', { password });
    assert.equal(r.status, 401, JSON.stringify(password).slice(0, 30));
    assert.equal(r.setCookie.length, 0);
  }
  const user = await account('normal@student.dhbw-mannheim.de');
  assert.equal((await user.admin('overview')).status, 401);
  assert.ok(!(await page(user)).html.includes('data-view'));
});

test('signing in cannot be done from another site (CSRF)', async () => {
  assert.equal((await person().admin('login', { password: PASSWORD }, { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await person().admin('login', null, { method: 'POST', raw: `password=${PASSWORD}`, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status, 403);
});

test('the right password signs in: a strict, HttpOnly cookie, and the panel', async () => {
  const r = await admin.admin('login', { password: PASSWORD });
  assert.equal(r.status, 200);
  const c = r.setCookie[0];
  for (const flag of ['__Host-aid=', 'HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert.ok(c.includes(flag), `cookie has ${flag}`);
  const p = await page(admin);
  assert.ok(p.html.includes('data-view="overview"'), 'the panel');
  assert.equal((await admin.admin('overview')).status, 200);
});

test('overview counts accounts, notes and messages', async () => {
  const mila = await account('mila@student.dhbw-mannheim.de', 'Mila K.');
  await mila.call('note', { course: 'WWI26SEA', eventId: '7', body: 'Blatt 3' }, { method: 'PUT' });
  await say(mila, 'global', 'Hallo');
  await say(person(), 'WWI26SEA', 'Gast hier');
  const o = (await admin.admin('overview')).data;
  assert.equal(o.users, 2);
  assert.equal(o.named, 1);
  assert.equal(o.notes, 1);
  assert.equal(o.messages, 2);
  assert.deepEqual(o.rooms.map((r) => [r.room, r.messages]).sort(), [['WWI26SEA', 1], ['global', 1]]);
  assert.equal(o.settings.guests, true);
});

test('messages: listed with who wrote them, deleted one by one or by sender', async () => {
  const troll = person();
  for (let i = 0; i < 3; i++) await say(troll, 'global', `<script>alert(${i})</script>`);
  let list = (await admin.admin('messages')).data.messages;
  assert.equal(list.length, 5);
  assert.equal(list.find((m) => m.body === 'Hallo').email, 'mila@student.dhbw-mannheim.de');
  assert.equal(list.find((m) => m.body === 'Gast hier').email, null);
  assert.deepEqual((await admin.admin('messages', null, { query: { room: 'WWI26SEA' } })).data.messages.map((m) => m.body), ['Gast hier']);

  const one = list.find((m) => m.body === '<script>alert(0)</script>');
  assert.equal((await admin.admin('delete-message', { id: one.id })).data.deleted, 1);
  assert.equal((await admin.admin('delete-sender', { sender: one.sender })).data.deleted, 2);
  list = (await admin.admin('messages')).data.messages;
  assert.deepEqual(list.map((m) => m.body).sort(), ['Gast hier', 'Hallo']);
  assert.deepEqual((await person().chat('messages', null, { query: { room: 'global' } })).data.messages.map((m) => m.body), ['Hallo'], 'gone for everyone');
});

test('a banned sender cannot write until unbanned', async () => {
  const mila = person();
  await mila.call('login', { email: 'mila@student.dhbw-mannheim.de', password: 'Ein langes Testpasswort 2026' });
  const sender = (await mila.chat('me')).data.you.id;
  assert.equal((await admin.admin('ban', { sender })).status, 200);
  assert.equal((await say(mila, 'global', 'Darf ich?')).status, 403);
  assert.deepEqual((await admin.admin('bans')).data.bans.map((b) => [b.sender, b.name]), [[sender, 'Mila K.']]);
  assert.equal((await admin.admin('messages')).data.messages.find((m) => m.sender === sender).banned, true);
  assert.equal((await say(person(), 'global', 'Andere schon')).status, 200, 'others are not affected');
  assert.equal((await admin.admin('unban', { sender })).status, 200);
  assert.equal((await say(mila, 'global', 'Wieder da')).status, 200);
});

test('accounts: found by address or name, a name removed, an account deleted', async () => {
  let users = (await admin.admin('users')).data.users;
  assert.deepEqual(users.map((u) => u.email).sort(), ['mila@student.dhbw-mannheim.de', 'normal@student.dhbw-mannheim.de']);
  assert.deepEqual((await admin.admin('users', null, { query: { q: 'MILA k' } })).data.users.map((u) => u.email), ['mila@student.dhbw-mannheim.de']);
  assert.deepEqual((await admin.admin('users', null, { query: { q: '%' } })).data.users, [], 'a % is searched for as a %, not as "anything"');
  const mila = users.find((u) => u.name === 'Mila K.');
  assert.equal(mila.notes, 1);

  assert.equal((await admin.admin('clear-name', { id: mila.id })).data.changed, 1);
  users = (await admin.admin('users')).data.users;
  assert.equal(users.find((u) => u.id === mila.id).name, null);

  assert.equal((await admin.admin('delete-user', { id: mila.id })).data.deleted, 1);
  assert.equal((await admin.admin('users')).data.users.length, 1);
  assert.equal((await person().call('login', { email: 'mila@student.dhbw-mannheim.de', password: 'Ein langes Testpasswort 2026' })).status, 401);
  assert.ok(!(await admin.admin('messages')).data.messages.some((m) => m.body === 'Wieder da'), 'their messages went with them');
});

test('ids are checked before they reach the database', async () => {
  for (const [action, body] of [['delete-message', { id: '1 OR 1=1' }], ['delete-message', {}], ['delete-sender', { sender: "x' OR '1'='1" }], ['ban', { sender: 'short' }],
    ['clear-name', { id: 'abc' }], ['delete-user', { id: "'; DROP TABLE users;--" }]]) {
    assert.equal((await admin.admin(action, body)).status, 400, `${action} ${JSON.stringify(body)}`);
  }
  assert.equal((await admin.admin('messages', null, { query: { room: 'nope' } })).status, 400);
  assert.equal((await admin.admin('messages', null, { query: { before: 'x' } })).status, 400);
  assert.equal((await admin.admin('users')).status, 200, 'users table still there');
});

test('changes cannot be made from another site, even with the admin cookie', async () => {
  assert.equal((await admin.admin('delete-user', { id: '00000000-0000-0000-0000-000000000000' }, { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await admin.admin('delete-sender', { sender: 'a'.repeat(12) }, { headers: { Origin: '', 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
});

test('signing out ends the session for good', async () => {
  const copy = admin.cookie;
  assert.equal((await admin.admin('logout', {})).status, 200);
  const stolen = person();
  stolen.cookie = copy;
  assert.equal((await stolen.admin('overview')).status, 401, 'a copied cookie is worthless after signing out');
  assert.ok(!(await page(stolen)).html.includes('data-view'));
});

test('guessing is stopped: 8 tries in 15 minutes', async () => {
  let last;
  for (let i = 0; i < 9; i++) last = await person().admin('login', { password: `geraten ${i}` });
  assert.equal(last.status, 429);
  assert.equal((await person().admin('login', { password: PASSWORD })).status, 429, 'even the right password has to wait');
});
