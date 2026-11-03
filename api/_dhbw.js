// Fetches from api.dhbw.app on behalf of the page, which may not call it
// directly (the API sends no CORS headers). Shared by the Vercel functions
// in this folder and by serve.mjs for local use. Files starting with "_"
// are not turned into functions by Vercel.

const API = 'https://api.dhbw.app';
const TTL = 5 * 60 * 1000;
const cache = new Map();

export const COURSE_ID = /^[A-Za-z0-9-]{1,40}$/;

// every event of a course: without archived=true the API drops the past ones,
// and the page shows the weeks already gone of the running theory phase
export const eventsPath = (id) => `/rapla/lectures/${id}/events?archived=true`;

export const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  // the page checks for this header to tell the proxy from a plain static server
  'X-DHBW-Proxy': '1',
};

// path is "/courses" or eventsPath(id)
export async function upstream(path) {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < TTL) return hit;
  try {
    const res = await fetch(API + path, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    const out = { at: Date.now(), status: res.status, body: await res.text() };
    if (res.ok) cache.set(path, out);
    return out;
  } catch {
    return { status: 502, body: '{"error":"api.dhbw.app not reachable"}' };
  }
}

// Vercel's Node handler signature
export async function respond(res, path) {
  const { status, body } = await upstream(path);
  for (const [k, v] of Object.entries(HEADERS)) res.setHeader(k, v);
  // let Vercel's edge cache answers for five minutes, then refresh in the background
  res.setHeader('Cache-Control', status === 200 ? 'public, s-maxage=300, stale-while-revalidate=600' : 'no-store');
  res.status(status).send(body);
}
