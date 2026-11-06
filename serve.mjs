// A small local server for the timetable. On Vercel the same job is done by
// the static files in public/ and the functions in api/.
//
//   node serve.mjs          serves public/ on http://localhost:8137
//   node serve.mjs 3000     on another port
//
// It passes requests through to api.dhbw.app, which does not allow browsers
// to call it directly (same code as the Vercel functions):
//   /api/courses                         every course
//   /api/rapla/lectures/<id>/events      every event of one course, past ones included
//   /api/mensa                           the Mensaria Metropol and greenes², this week
// and runs the accounts (/api/account/<action>, see api/_account.js) against
// DATABASE_URL from .env, or else a local Postgres (PGlite) in .data/. E-mails
// are not sent locally: their links appear in this console.
// /dev.html, the page with test data, is served from the project folder.
// Every answer carries the security headers from vercel.json, as in production.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, mkdirSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { upstream, HEADERS, COURSE_ID, eventsPath, MENSA_PATH, trimMensa } from './api/_dhbw.js';
import { useDatabase } from './api/_db.js';
import { handleAccount } from './api/_account.js';

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

// the headers vercel.json gives each path, so local answers match production
const vercel = JSON.parse(readFileSync(join(here, 'vercel.json'), 'utf8'));
// sources are plain paths with "(.*)" wildcards, the only pattern vercel.json uses here
const toRegex = (source) => new RegExp(`^${source.split('(.*)').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
const headerRules = (vercel.headers || []).map((r) => ({
  test: toRegex(r.source),
  headers: Object.fromEntries(r.headers.map((h) => [h.key, h.value])),
}));
const headersFor = (path) => Object.assign({}, ...headerRules.filter((r) => r.test.test(path)).map((r) => r.headers));

async function proxy(path, res) {
  const id = path.match(/^\/rapla\/lectures\/([^/]+)\/events$/)?.[1];
  if (path !== '/courses' && path !== '/mensa' && !(id && COURSE_ID.test(id))) {
    res.writeHead(404, { ...HEADERS, 'Cache-Control': 'no-store' }).end('{"error":"unknown path"}');
    return;
  }
  let { status, body } = await upstream(id ? eventsPath(id) : path === '/mensa' ? MENSA_PATH : path);
  if (status === 200 && path === '/mensa') {
    try { body = trimMensa(body); } catch { status = 502; body = '{"error":"unexpected answer from api.dhbw.app"}'; }
  }
  res.writeHead(status, { ...HEADERS, 'Cache-Control': 'no-store' }).end(body);
}

const MAX_BODY = 16 * 1024;
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
    req.on('end', () => (size > MAX_BODY ? reject(Object.assign(new Error('too large'), { status: 413 })) : resolve(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', reject);
  });
}

async function account(action, req, url, res) {
  const json = (status, body, cookies = []) => res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    ...(cookies.length ? { 'Set-Cookie': cookies } : {}),
  }).end(JSON.stringify(body));
  let body = null;
  if (Number(req.headers['content-length'] || 0) > MAX_BODY) {
    res.setHeader('Connection', 'close');
    return json(413, { error: 'too-large', message: 'Anfrage zu groß.' });
  }
  // only JSON is read; anything else reaches handleAccount without a body and is refused there (CSRF)
  if (req.method !== 'GET' && req.method !== 'HEAD' && /^application\/json\b/i.test(req.headers['content-type'] || '')) {
    try {
      const text = await readBody(req);
      body = text ? JSON.parse(text) : null;
    } catch (err) {
      return json(err.status || 400, { error: err.status === 413 ? 'too-large' : 'bad-request', message: 'Ungültige Anfrage.' });
    }
  }
  const out = await handleAccount({
    method: req.method, action, query: Object.fromEntries(url.searchParams), body, headers: req.headers,
    ip: req.socket.remoteAddress, ctx: { dev: true, origin },
  });
  json(out.status, out.body, out.cookies);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    let path;
    try { path = decodeURIComponent(url.pathname); } catch { res.writeHead(400).end(); return; } // "/%E0" is not a path
    for (const [k, v] of Object.entries(headersFor(url.pathname))) res.setHeader(k, v);

    if (path.startsWith('/api/account/')) return await account(path.slice(13), req, url, res);
    if (path.startsWith('/api/')) return await proxy(path.slice(4), res);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }

    const file = path === '/dev.html' ? join(here, 'dev.html') : normalize(join(root, path === '/' ? 'index.html' : path));
    if (path !== '/dev.html' && !file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Nicht gefunden. Erst "node build.mjs" ausführen?');
    }
  } catch (err) {
    // one bad request must never take the server down
    console.error(err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

// accounts: DATABASE_URL (e.g. Neon) if set, else a Postgres in .data/ for trying it out
let database = 'Neon (DATABASE_URL)';
if (!process.env.DATABASE_URL) {
  try {
    const { PGlite } = await import('@electric-sql/pglite');
    const memory = process.env.PGLITE_DIR === 'memory'; // the tests: a fresh database that's gone afterwards
    if (!memory) mkdirSync(join(here, '.data'), { recursive: true });
    const db = new PGlite(memory ? undefined : join(here, '.data', 'pglite'));
    await db.waitReady;
    useDatabase(async (text, params) => (await db.query(text, params)).rows);
    database = memory ? 'im Speicher (Test)' : 'lokale Datenbank in .data/';
  } catch {
    database = 'keine (npm install für die lokale Datenbank)';
  }
}

server.listen(port, () => console.log(`Stundenplan läuft auf ${origin}  (Konten: ${database}; Strg+C zum Beenden)`));
