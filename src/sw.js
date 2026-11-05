// Offline support for the timetable. build.mjs fills in VERSION and writes
// this file to public/sw.js.
//
// - The page: network first, so a deploy shows up on the next visit; with no
//   network, or none within a few seconds, the last saved copy. Every course
//   is the same page (?kurs=…), so one copy serves them all.
// - Course plans and the mensa (/api/…): network first as well, and every good
//   answer is kept, so a plan opened once is there offline. A saved answer
//   carries when it was saved (x-sw-saved) and, when it stands in for the
//   network, x-sw-offline, so the page can say how old it is.
// - Icons and the manifest: from the cache.

const VERSION = '__VERSION__';
const SHELL = `shell-${VERSION}`;
const DATA = 'data-v1'; // kept across deploys: the plans don't change with the code
const MAX_DATA = 30;    // saved answers (courses + mensa); the oldest go first
const PAGE_WAIT = 4000; // how long a slow network gets before the saved page is shown
const DATA_WAIT = 6000;

const scope = new URL(self.registration.scope);
const PAGE = new URL('./', scope).href;
const ASSETS = ['manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png']
  .map((p) => new URL(p, scope).href);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await cache.addAll([PAGE, ...ASSETS]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== SHELL && key !== DATA) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== scope.origin) return;
  const path = url.pathname.slice(scope.pathname.length - 1); // "/api/mensa" relative to the scope

  if (req.mode === 'navigate') {
    // only the site's own page; dev.html and anything else just go to the network
    if (url.href.split(/[?#]/)[0] === PAGE) event.respondWith(page(event));
  } else if (path.startsWith('/api/rapla/lectures/') || path === '/api/mensa') {
    event.respondWith(data(event));
  } else if (ASSETS.includes(url.href)) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  }
});

// resolves with undefined after ms, so a race can fall back to the cache
const after = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function page(event) {
  const cache = await caches.open(SHELL);
  const network = fetch(event.request).then(async (res) => {
    if (res.ok && res.type === 'basic') await cache.put(PAGE, res.clone());
    return res;
  });
  event.waitUntil(network.catch(() => {}));
  const first = await Promise.race([network.catch(() => null), after(PAGE_WAIT)]);
  if (first && first.ok) return first;
  const saved = await cache.match(PAGE);
  if (saved) return saved;
  return first || network; // nothing saved yet: the network's answer, or fail like a normal offline page
}

async function data(event) {
  const req = event.request;
  const cache = await caches.open(DATA);
  const network = fetch(req).then(async (res) => {
    // only the proxy's own good answers; an error page must never replace a saved plan
    if (res.ok && res.headers.has('x-dhbw-proxy')) {
      const headers = new Headers(res.headers);
      headers.set('x-sw-saved', String(Date.now()));
      await cache.put(req, new Response(await res.clone().blob(), { status: res.status, headers }));
      await trim(cache);
    }
    return res;
  });
  event.waitUntil(network.catch(() => {}));

  const first = await Promise.race([network.catch(() => null), after(DATA_WAIT)]);
  if (first && first.ok) return first;
  const saved = await cache.match(req);
  if (saved) {
    const headers = new Headers(saved.headers);
    headers.set('x-sw-offline', '1');
    return new Response(saved.body, { status: saved.status, headers });
  }
  return first || network; // the network's own answer or error, as without a worker
}

async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_DATA) return;
  const dated = await Promise.all(keys.map(async (k) => [k, +((await cache.match(k))?.headers.get('x-sw-saved') || 0)]));
  dated.sort((a, b) => a[1] - b[1]);
  for (const [k] of dated.slice(0, keys.length - MAX_DATA)) await cache.delete(k);
}
