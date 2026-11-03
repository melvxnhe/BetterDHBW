// A tiny local server for the timetable, no dependencies. On Vercel the
// same job is done by the static files in public/ and the functions in api/.
//
//   node serve.mjs          serves public/ on http://localhost:8137
//   node serve.mjs 3000     on another port
//
// It passes two kinds of requests through to api.dhbw.app, which does not
// allow browsers to call it directly (same code as the Vercel functions):
//   /api/courses                         every course
//   /api/rapla/lectures/<id>/events      every event of one course, past ones included
// /dev.html, the page with test data, is served from the project folder.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { upstream, HEADERS, COURSE_ID, eventsPath } from './api/_dhbw.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, 'public') + sep;
const port = Number(process.argv[2]) || 8137;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.ics': 'text/calendar; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

async function proxy(path, res) {
  const id = path.match(/^\/rapla\/lectures\/([^/]+)\/events$/)?.[1];
  if (path !== '/courses' && !(id && COURSE_ID.test(id))) {
    res.writeHead(404, { ...HEADERS, 'Cache-Control': 'no-store' }).end('{"error":"unknown path"}');
    return;
  }
  const { status, body } = await upstream(id ? eventsPath(id) : path);
  res.writeHead(status, { ...HEADERS, 'Cache-Control': 'no-store' }).end(body);
}

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.startsWith('/api/')) return proxy(path.slice(4), res);

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
}).listen(port, () => console.log(`Stundenplan läuft auf http://localhost:${port}  (Strg+C zum Beenden)`));
