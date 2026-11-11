// A small local server for the timetable. On Vercel the same job is done by
// the static files in public/ and the functions in api/.
//
//   node serve.mjs          serves public/ on http://localhost:8137
//   node serve.mjs 3000     on another port
//
// - /api/courses, /api/rapla/lectures/<id>/events, /api/mensa: passed through
//   to api.dhbw.app, which does not allow browsers to call it directly (the
//   same code as the Vercel functions, api/_dhbw.js).
// - /api/account/<action>, /api/chat/<action>, /api/admin/<action> and /admin:
//   the accounts, the chat and the admin area (api/_account.js, api/_chat.js,
//   api/_admin.js), against DATABASE_URL from .env, or else
//   a local Postgres (PGlite) in .data/. E-mails are not sent locally: their
//   links appear in this console.
// - /dev.html, the page with test data, is served from the project folder.
// Every answer carries the security headers from vercel.json, as in production.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, mkdirSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answer, HEADERS } from './api/_dhbw.js';
import { useDatabase } from './api/_db.js';
import { handleAccount } from './api/_account.js';
import { handleChat } from './api/_chat.js';
import { handleAdmin } from './api/_admin.js';
import { MAX_BODY, JSON_HEADERS, TOO_LARGE, BAD_REQUEST, bodyOf } from './api/_http.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, 'public') + sep;
const port = Number(process.argv[2]) || 8137;
const origin = `http://localhost:${port}`;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.ics': 'text/calendar; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

try { process.loadEnvFile(join(here, '.env')); } catch { /* no .env */ }

// ---------- the headers vercel.json gives each path, so local answers match production ----------

const vercel = JSON.parse(readFileSync(join(here, 'vercel.json'), 'utf8'));
// sources are plain paths with "(.*)" wildcards, the only pattern vercel.json uses here
const toRegex = (source) => new RegExp(`^${source.split('(.*)').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
const headerRules = (vercel.headers || []).map((r) => ({
  test: toRegex(r.source),
  headers: Object.fromEntries(r.headers.map((h) => [h.key, h.value])),
}));
const headersFor = (path) => Object.assign({}, ...headerRules.filter((r) => r.test.test(path)).map((r) => r.headers));

// ---------- /api/…: api.dhbw.app ----------

async function proxy(path, res) {
  const { status, body } = await answer(path);
  res.writeHead(status, { ...HEADERS, 'Cache-Control': 'no-store' }).end(body);
}

// ---------- /api/account/<action>, /api/chat/<action> ----------

const APIS = { account: handleAccount, chat: handleChat, admin: handleAdmin };

// Reads at most MAX_BODY; anything beyond is read and dropped (up to 1 MB,
// then the connection goes), so the client still gets its 413.
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size <= MAX_BODY) chunks.push(c);
      else if (size > 1024 * 1024) req.destroy();
    });
    req.on('end', () => (size > MAX_BODY ? reject(TOO_LARGE) : resolve(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', reject);
  });
}

async function json(handle, action, req, url, res) {
  const send = (out) => res.writeHead(out.status, { ...JSON_HEADERS, ...out.headers, ...(out.cookies.length ? { 'Set-Cookie': out.cookies } : {}) }).end(bodyOf(out));
  if (Number(req.headers['content-length'] || 0) > MAX_BODY) {
    res.setHeader('Connection', 'close');
    return send(TOO_LARGE);
  }
  let body = null;
  // only JSON is read; anything else reaches the API without a body and is refused there (CSRF)
  if (req.method !== 'GET' && req.method !== 'HEAD' && /^application\/json\b/i.test(req.headers['content-type'] || '')) {
    try {
      const text = await readBody(req);
      body = text ? JSON.parse(text) : null;
    } catch (err) {
      return send(err === TOO_LARGE ? TOO_LARGE : BAD_REQUEST);
    }
  }
  send(await handle({
    method: req.method, action, query: Object.fromEntries(url.searchParams), body, headers: req.headers,
    ip: req.socket.remoteAddress, ctx: { dev: true, origin },
  }));
}

// ---------- everything else: the built page ----------

async function file(path, req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end();
  const dev = path === '/dev.html';
  const name = dev ? join(here, 'dev.html') : normalize(join(root, path === '/' ? 'index.html' : path));
  if (!dev && !name.startsWith(root)) return res.writeHead(403).end(); // "/../…": nothing outside public/
  try {
    const body = await readFile(name);
    res.writeHead(200, { 'Content-Type': types[extname(name)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }).end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Nicht gefunden. Erst "node build.mjs" ausführen?');
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    let path;
    try { path = decodeURIComponent(url.pathname); } catch { res.writeHead(400).end(); return; } // "/%E0" is not a path
    for (const [k, v] of Object.entries(headersFor(url.pathname))) res.setHeader(k, v);

    const name = path.startsWith('/api/') ? path.split('/')[2] : ''; // "/api/chat/send" → "chat"
    if (path === '/admin') await json(handleAdmin, 'page', req, url, res); // as vercel.json rewrites it
    else if (Object.hasOwn(APIS, name)) await json(APIS[name], path.slice(`/api/${name}/`.length), req, url, res);
    else if (path.startsWith('/api/')) await proxy(path.slice('/api'.length), res);
    else await file(path, req, res);
  } catch (err) {
    // one bad request must never take the server down
    console.error(err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

// ---------- accounts: DATABASE_URL (e.g. Neon) if set, else a Postgres in .data/ for trying it out ----------

async function localDatabase() {
  let PGlite;
  try {
    ({ PGlite } = await import('@electric-sql/pglite'));
  } catch {
    return 'keine (npm install für die lokale Datenbank)';
  }
  const memory = process.env.PGLITE_DIR === 'memory'; // the tests: a fresh database that's gone afterwards
  try {
    if (!memory) mkdirSync(join(here, '.data'), { recursive: true });
    const db = new PGlite(memory ? undefined : join(here, '.data', 'pglite'));
    await db.waitReady;
    useDatabase(async (text, params) => (await db.query(text, params)).rows);
    return memory ? 'im Speicher (Test)' : 'lokale Datenbank in .data/';
  } catch {
    // e.g. after the server was killed mid-write; it only holds local test accounts
    return 'keine (.data/pglite lässt sich nicht öffnen; den Ordner löschen, dann legt der Server eine neue an)';
  }
}

const database = process.env.DATABASE_URL ? 'Neon (DATABASE_URL)' : await localDatabase();

server.listen(port, () => console.log(`Stundenplan läuft auf ${origin}  (Konten: ${database}; Strg+C zum Beenden)`));
