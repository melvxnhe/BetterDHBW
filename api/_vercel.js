// Turns one of the JSON APIs (_account.js, _chat.js) into a Vercel function:
// reads the request the way Vercel hands it over, sends the answer back.
// /api/<name>/<action> arrives rewritten as /api/<name>?action=<action>
// (vercel.json).

import { MAX_BODY, JSON_HEADERS, TOO_LARGE, BAD_REQUEST } from './_http.js';

export const vercel = (handle) => async function handler(req, res) {
  const send = (out) => {
    for (const [k, v] of Object.entries({ ...JSON_HEADERS, ...out.headers })) res.setHeader(k, v);
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
  const action = String(query.action || (String(req.url || '').match(/\/api\/[a-z]+\/([a-z-]+)/) || [])[1] || '');
  delete query.action;

  send(await handle({ method: req.method, action, query, body, headers: req.headers, ip }));
};
