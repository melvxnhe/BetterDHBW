// Rate limits, counted in the database because the functions are stateless:
// a key ("login:ip:1.2.3.4"), how often it was hit, and when its window ends.

import { q } from './_db.js';
import { Problem } from './_http.js';

const HOUR = 3600;

// Counts a hit for `key` in a window of `seconds`; true while within `max`.
export async function hit(key, max, seconds = HOUR) {
  const [row] = await q(
    `INSERT INTO rate_limits (key, count, reset_at) VALUES ($1, 1, now() + make_interval(secs => $2))
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limits.reset_at < now() THEN 1 ELSE rate_limits.count + 1 END,
       reset_at = CASE WHEN rate_limits.reset_at < now() THEN now() + make_interval(secs => $2) ELSE rate_limits.reset_at END
     RETURNING count`, [key, seconds]);
  return row.count <= max;
}

// The same, ending the request with a 429 once the limit is passed.
export async function limit(key, max, seconds = HOUR, message = 'Zu viele Versuche. Bitte warte ein paar Minuten.') {
  if (!(await hit(key, max, seconds))) throw new Problem(429, 'rate-limited', message);
}

// How often `key` was hit in its running window, without counting a hit.
export async function hits(key) {
  const [row] = await q(`SELECT count FROM rate_limits WHERE key = $1 AND reset_at > now()`, [key]);
  return row?.count || 0;
}

export const forget = (key) => q(`DELETE FROM rate_limits WHERE key = $1`, [key]);

// windows that ended more than a day ago
export const sweep = () => q(`DELETE FROM rate_limits WHERE reset_at < now() - interval '1 day'`);
