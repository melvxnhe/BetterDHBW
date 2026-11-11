// What the JSON APIs (accounts, chat) and their two adapters (the Vercel
// functions through _vercel.js, and serve.mjs) agree on: the shape of an
// answer, the checks every request passes first, and the size limit.

export const MAX_BODY = 16 * 1024;

export const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

// An answer: the status, a body (sent as JSON; a string is sent as it is, for
// a page), the Set-Cookie values that go with it, and headers that differ
// from JSON_HEADERS (a cache lifetime, another content type).
export const reply = (status, body, cookies = [], headers = {}) => ({ status, body, cookies, headers });
export const fail = (status, error, message, extra = {}) => reply(status, { error, message, ...extra });
export const bodyOf = (out) => (typeof out.body === 'string' ? out.body : JSON.stringify(out.body));

export const TOO_LARGE = fail(413, 'too-large', 'Anfrage zu groß.');
export const BAD_REQUEST = fail(400, 'bad-request', 'Ungültige Anfrage.');

// Thrown anywhere below a route to end the request with that answer.
export class Problem extends Error {
  constructor(status, error, message) { super(message); Object.assign(this, { status, error }); }
}

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

// One API out of a table of routes. `methods` names each action's HTTP
// method, `routes` holds the functions; both adapters call the result with
// { method, action, query, body, headers, ip, ctx } and send what it returns.
// - ready(): false while the API can't work here (no database) → 503
// - tick(): housekeeping, run on about 2 % of requests instead of on a schedule
export function api(name, methods, routes, { ready = () => true, tick = null } = {}) {
  return async function handle({ method, action, query = {}, body = null, headers = {}, ip = '', ctx = {} }) {
    if (!Object.hasOwn(methods, action)) return fail(404, 'not-found', 'Unbekannte Aktion.');
    if (method !== methods[action]) return fail(405, 'method', 'Falsche Methode.');
    if (!ready()) return fail(503, 'not-configured', 'Konten sind auf diesem Server nicht eingerichtet.');
    if (method !== 'GET') {
      const problem = csrfProblem(headers);
      if (problem) return fail(403, 'forbidden', problem);
      if (!body || typeof body !== 'object' || Array.isArray(body)) return BAD_REQUEST;
    }

    try {
      if (tick && Math.random() < 0.02) await tick();
      return await routes[action]({ query, body: body || {}, headers, ip: String(ip || 'unknown').slice(0, 64), ctx });
    } catch (err) {
      if (err instanceof Problem) return fail(err.status, err.error, err.message);
      console.error(name, action, err);
      return fail(500, 'server', 'Da ist etwas schiefgegangen. Bitte später noch einmal versuchen.');
    }
  };
}
