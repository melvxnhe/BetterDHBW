// End-to-end tests for the chat, over HTTP, against serve.mjs with a fresh
// in-memory database: who can write under which name, what a message may
// contain, forged origins, flooding, and that rooms stay apart.
//
//   npm test

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, person as personAt } from './_server.mjs';

const BASE = 'http://localhost:8140';
let server;
before(async () => { server = await startServer(8140); });
after(() => server.stop());

const person = () => personAt(BASE);
const send = (who, room, body, opts) => who.chat('send', { room, body }, opts);
const read = async (room, after) => (await person().chat('messages', null, { query: after === undefined ? { room } : { room, after } })).data.messages;
const char = (code) => String.fromCodePoint(code);

// a confirmed account, signed in
async function account(email, password = 'Ein langes Testpasswort 2026') {
  const who = person();
  assert.equal((await who.call('register', { email, password })).status, 202);
  assert.equal((await who.call('verify', { token: server.lastLink('bestaetigen') })).status, 200);
  return who;
}

const guest = person();

test('an empty room answers with no messages, and the answer may be cached briefly', async () => {
  const r = await guest.chat('messages', null, { query: { room: 'global' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.messages, []);
  assert.match(r.headers.get('cache-control'), /s-maxage=2/);
  assert.equal(r.setCookie.length, 0, 'reading sets no cookie');
});

test('only "global" and course codes are rooms', async () => {
  for (const room of ['wwi26sea', 'Global', 'global2', '', 'A'.repeat(41), 'WWI26SEA; DROP TABLE chat_messages;--', '../x']) {
    assert.equal((await guest.chat('messages', null, { query: { room } })).status, 400, `reading ${JSON.stringify(room)}`);
    assert.equal((await send(guest, room, 'hallo')).status, 400, `writing to ${JSON.stringify(room)}`);
  }
  assert.equal((await guest.chat('messages', null, { query: { room: 'global', after: '1 OR 1=1' } })).status, 400);
});

test('a visitor without an account writes as "Gast 1234", tied to an HttpOnly cookie', async () => {
  const me = await guest.chat('me');
  assert.equal(me.status, 200);
  assert.match(me.data.you.name, /^Gast \d{4}$/);
  assert.equal(me.data.you.guest, true);
  const c = me.setCookie[0];
  for (const flag of ['__Host-gid=', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) assert.ok(c.includes(flag), `cookie has ${flag}`);
  const again = await guest.chat('me');
  assert.equal(again.data.you.name, me.data.you.name, 'the same guest keeps the name');
  assert.equal(again.setCookie.length, 0);

  const sent = await send(guest, 'global', 'Hallo zusammen');
  assert.equal(sent.status, 200);
  assert.equal(sent.data.message.name, me.data.you.name);
  assert.equal(sent.data.message.from, me.data.you.id);
  assert.equal(sent.data.message.guest, true);

  const other = person();
  const theirs = await send(other, 'global', 'Hi');
  assert.notEqual(theirs.data.message.from, sent.data.message.from, 'another visitor is another sender');
});

test('messages are stored as plain text; the page shows them as text', async () => {
  const xss = '<img src=x onerror=alert(1)> <script>alert(2)</script>';
  const r = await send(guest, 'global', xss);
  assert.equal(r.data.message.body, xss);
  assert.equal((await read('global')).at(-1).body, xss);
});

test('invisible and direction-switching characters are removed, emoji survive', async () => {
  const hidden = `Zah${char(0x200b)}len ${char(0x202e)}dlo${char(0x202c)} ok${char(0)}${char(0x2028)}!`;
  assert.equal((await send(guest, 'global', hidden)).data.message.body, 'Zahlen dlo ok!');
  const coder = `${char(0x1f469)}${char(0x200d)}${char(0x1f4bb)} geht`;
  assert.equal((await send(guest, 'global', coder)).data.message.body, coder);
  const lines = ['a', '', '', '', 'b  ', ' c'].join(char(13) + char(10));
  assert.equal((await send(guest, 'global', lines)).data.message.body, ['a', '', 'b', ' c'].join(char(10)));
});

test('empty and oversized messages are refused', async () => {
  assert.equal((await send(guest, 'global', `   ${char(10)} `)).status, 400);
  assert.equal((await send(guest, 'global', char(0x200b))).status, 400, 'only invisible characters');
  assert.equal((await send(guest, 'global', 'x'.repeat(501))).status, 400);
  assert.equal((await send(guest, 'global', 'x'.repeat(500))).status, 200);
  assert.equal((await send(guest, 'global', 42)).status, 400);
  assert.equal((await guest.chat('send', null, { method: 'POST', raw: JSON.stringify({ room: 'global', body: 'x'.repeat(20000) }) })).status, 413);
});

test('cross-site requests cannot write (CSRF)', async () => {
  assert.equal((await send(guest, 'global', 'x', { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await guest.chat('send', null, { method: 'POST', raw: 'room=global&body=x', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status, 403);
  assert.equal((await send(guest, 'global', 'x', { headers: { Origin: '', 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await guest.chat('send')).status, 405, 'GET on send');
  assert.equal((await guest.chat('nope')).status, 404);
});

test('rooms stay apart, and "after" returns only what is newer', async () => {
  const first = await send(guest, 'WWI26SEA', 'Nur im Kurs');
  assert.equal(first.status, 200);
  assert.ok(!(await read('global')).some((m) => m.body === 'Nur im Kurs'));
  assert.deepEqual((await read('WWI26SEA')).map((m) => m.body), ['Nur im Kurs']);
  const second = await send(guest, 'WWI26SEA', 'Zweite');
  assert.deepEqual((await read('WWI26SEA', first.data.message.id)).map((m) => m.body), ['Zweite']);
  assert.deepEqual(await read('WWI26SEA', second.data.message.id), []);
});

test('a signed-in user writes as "Nutzer 1234" until they pick a name', async () => {
  const mila = await account('mila@student.dhbw-mannheim.de');
  const me = await mila.chat('me');
  assert.match(me.data.you.name, /^Nutzer \d{4}$/);
  assert.equal(me.data.you.guest, false);
  assert.equal(me.data.you.named, false);

  for (const name of ['M', 'x'.repeat(25), 'Gast 4821', 'gast', 'Nutzer 1', '<b>Mila</b>', 'Mila@K', `Mi${char(0x202e)}la`]) {
    assert.equal((await mila.call('name', { name })).status, 400, `name ${JSON.stringify(name)}`);
  }
  const named = await mila.call('name', { name: '  Mila   K. ' });
  assert.equal(named.status, 200);
  assert.equal(named.data.user.name, 'Mila K.');
  assert.equal((await mila.call('me')).data.user.name, 'Mila K.');

  const sent = await send(mila, 'global', 'Jetzt mit Namen');
  assert.equal(sent.data.message.name, 'Mila K.');
  assert.equal(sent.data.message.guest, false);
  assert.equal(sent.setCookie.length, 0, 'no guest cookie for a signed-in user');

  assert.equal((await person().call('name', { name: 'Hacker' })).status, 401, 'guests have no name to set');
  const copycat = await account('copycat@student.dhbw-mannheim.de');
  assert.equal((await copycat.call('name', { name: 'mila k.' })).status, 409, 'a name is unique, whatever the capitals');
  assert.equal((await mila.call('name', { name: 'Mila K.' })).status, 200, 'keeping your own name is fine');
});

test('flooding is stopped: 10 messages a minute per sender', async () => {
  const spammer = person();
  let last;
  for (let i = 0; i < 11; i++) last = await send(spammer, 'TINF25CS1', `spam ${i}`);
  assert.equal(last.status, 429);
  assert.equal((await read('TINF25CS1')).length, 10);
  assert.equal((await send(person(), 'TINF25CS1', 'jemand anderes')).status, 200, 'others can still write');
});

test('deleting an account deletes its messages; the export lists them', async () => {
  const eve = await account('eve@dhbw-mannheim.de', 'Eves langes Passwort hier');
  await send(eve, 'WIB26A', 'Bin gleich weg');
  const data = (await eve.call('export')).data;
  assert.deepEqual(data.chat.map((m) => [m.room, m.body]), [['WIB26A', 'Bin gleich weg']]);
  assert.equal((await eve.call('delete', { password: 'Eves langes Passwort hier' })).status, 200);
  assert.deepEqual(await read('WIB26A'), []);
});
