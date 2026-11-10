// What the account code and its two adapters (the Vercel function
// api/account.js and serve.mjs) agree on: the shape of an answer, the errors
// both give before a request reaches the account code, and the size limit.

export const MAX_BODY = 16 * 1024;

export const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

// An answer: the status, a JSON body and the Set-Cookie values that go with it.
export const reply = (status, body, cookies = []) => ({ status, body, cookies });
export const fail = (status, error, message, extra = {}) => reply(status, { error, message, ...extra });

export const TOO_LARGE = fail(413, 'too-large', 'Anfrage zu groß.');
export const BAD_REQUEST = fail(400, 'bad-request', 'Ungültige Anfrage.');

// Thrown anywhere below a route to end the request with that answer.
export class Problem extends Error {
  constructor(status, error, message) { super(message); Object.assign(this, { status, error }); }
}
