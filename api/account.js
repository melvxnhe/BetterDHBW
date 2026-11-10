// /api/account/<action> (rewritten to /api/account?action=<action> in
// vercel.json): sign-up, login, settings and notes. The logic lives in
// _account.js; this file only adapts Vercel's request and response.
import { handleAccount } from './_account.js';
import { MAX_BODY, JSON_HEADERS, TOO_LARGE, BAD_REQUEST } from './_http.js';

export default async function handler(req, res) {
  const send = (out) => {
    for (const [k, v] of Object.entries(JSON_HEADERS)) res.setHeader(k, v);
    if (out.cookies.length) res.setHeader('Set-Cookie', out.cookies);
    res.status(out.status).send(JSON.stringify(out.body));
  };

  let body = null;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (Number(req.headers['content-length'] || 0) > MAX_BODY) return send(TOO_LARGE);
    try {
      body = req.body; // Vercel parses JSON bodies; a broken one throws here
    } catch {
      return send(BAD_REQUEST);
    }
    if (typeof body === 'string' || Buffer.isBuffer(body)) {
      if (body.length > MAX_BODY) return send(TOO_LARGE);
      try { body = JSON.parse(String(body)); } catch { return send(BAD_REQUEST); }
    }
  }

  // Vercel overwrites these with the real client address; anything the client sent is replaced
  const ip = req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress;
  const query = { ...req.query };
  // from the rewrite's ?action=, or straight from the path if it arrives unrewritten
  const action = String(query.action || (String(req.url || '').match(/\/api\/account\/([a-z-]+)/) || [])[1] || '');
  delete query.action;

  send(await handleAccount({ method: req.method, action, query, body, headers: req.headers, ip }));
}
