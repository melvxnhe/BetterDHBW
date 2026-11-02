// A tiny server for the timetable, no dependencies.
//
//   node serve.mjs          serves this folder on http://localhost:8137
//   node serve.mjs 3000     on another port
//
// It also passes two kinds of requests through to api.dhbw.app, which does
// not allow browsers to call it directly:
//   /api/courses                         every course
//   /api/rapla/lectures/<id>/events      the upcoming events of one course
// Answers are cached for five minutes.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.argv[2]) || 8137;
const API = 'https://api.dhbw.app';
const TTL = 5 * 60 * 1000;
const ALLOWED = /^\/(courses|rapla\/lectures\/[A-Za-z0-9-]{1,40}\/events)$/;
const cache = new Map();
const types = {
  '.html': 'text/html; charset=utf-8',
  '.ics': 'text/calendar; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

async function proxy(path, res) {
  const head = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-DHBW-Proxy': '1' };
  if (!ALLOWED.test(path)) {
    res.writeHead(404, head).end('{"error":"unknown path"}');
    return;
  }
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < TTL) {
    res.writeHead(hit.status, head).end(hit.body);
    return;
  }
  try {
    const up = await fetch(API + path, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    const body = await up.text();
    if (up.ok) cache.set(path, { at: Date.now(), status: up.status, body });
    res.writeHead(up.status, head).end(body);
  } catch {
    res.writeHead(502, head).end('{"error":"api.dhbw.app not reachable"}');
  }
}

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.startsWith('/api/')) return proxy(path.slice(4), res);

  const file = normalize(join(root, path === '/' ? 'index.html' : path));
  if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Nicht gefunden');
  }
}).listen(port, () => console.log(`Stundenplan läuft auf http://localhost:${port}  (Strg+C zum Beenden)`));
