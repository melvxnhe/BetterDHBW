// What the test files share: a server of their own (serve.mjs with a fresh
// in-memory database, e-mails printed to its console) and a tiny client.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

// Starts serve.mjs on `port`. Returns { base, log(), lastLink(kind), stop() }.
export async function startServer(port) {
  let log = '';
  const child = spawn(process.execPath, ['serve.mjs', String(port)], { cwd: root, env: { ...process.env, PGLITE_DIR: 'memory', DATABASE_URL: '', RESEND_API_KEY: '', SMTP_USER: '' } });
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 100 && !log.includes('läuft auf'); i++) await new Promise((r) => setTimeout(r, 100));
  return {
    base: `http://localhost:${port}`,
    log: () => log,
    // the newest link of a kind from the server console (local mode: mails are printed there)
    lastLink: (kind) => [...log.matchAll(new RegExp(`konto=${kind}#token=([A-Za-z0-9_-]+)`, 'g'))].at(-1)?.[1],
    stop: () => child.kill(),
  };
}

// A "person": JSON in and out, with a cookie jar of their own.
//   call(action, body, opts)   /api/account/<action>
//   chat(action, body, opts)   /api/chat/<action>
// opts: { method, headers, raw (a body sent as is), query }
export function person(base) {
  const jar = new Map();
  const request = (api) => async (action, body, { method = body ? 'POST' : 'GET', headers = {}, raw, query } = {}) => {
    const res = await fetch(`${base}/api/${api}/${action}${query ? `?${new URLSearchParams(query)}` : ''}`, {
      method,
      headers: { ...(body || raw ? { 'Content-Type': 'application/json', Origin: base } : {}), ...(jar.size ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}), ...headers },
      body: raw ?? (body ? JSON.stringify(body) : undefined),
    });
    const setCookie = res.headers.getSetCookie();
    for (const c of setCookie) {
      const [pair] = c.split(';');
      const name = pair.slice(0, pair.indexOf('='));
      if (/Max-Age=0/.test(c)) jar.delete(name); else jar.set(name, pair.slice(name.length + 1));
    }
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    return { status: res.status, data, setCookie, headers: res.headers };
  };
  return {
    call: request('account'),
    chat: request('chat'),
    // the cookies as one value, to hand a session to another "device"
    get cookie() { return JSON.stringify([...jar]); },
    set cookie(v) { jar.clear(); for (const [k, val] of v ? JSON.parse(v) : []) jar.set(k, val); },
  };
}
