// Builds the DHBW Mannheim timetable site from the live Rapla data.
//
//   node build.mjs                     fetch fresh data, then build
//   node build.mjs --offline           build from data/*.json
//   node build.mjs --course WWI26AWIA  another course for the homepage preview
//
// Writes public/ (index.html with CSS and JS inlined: the homepage with the
// search, every Mannheim course and a live preview of one course; plus the
// icons, the manifest and the service worker of the installable app) and
// dev.html (worst-case data sets behind a switcher, for testing only; it
// stays out of public/ so it is never deployed). Courses open at ?kurs=<name>
// and are fetched in the browser through /api, because api.dhbw.app does not
// allow cross-origin calls: the functions in api/ on Vercel, serve.mjs locally.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Script } from 'node:vm';
import { iconSVG, iconPNG } from './src/icon.mjs';
import { normalize, splitBlock, toWeeks, partsOf, hm } from './src/render.js';
import { courseList } from './src/catalog.js';
import { homeHTML, homeFooterHTML } from './src/home.js';
import { pageHTML, withCsp } from './src/page.js';
import { devData, devTail, DEV_STYLE } from './src/dev.js';

const API = 'https://api.dhbw.app';
const TITLE = 'Stundenpläne der DHBW Mannheim';
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const COURSE = (arg('--course') || 'WWI26SEA').toUpperCase().replace(/^MA-+/, '');
const offline = process.argv.includes('--offline');
// LF only: browsers turn CRLF into LF before hashing an inline script or style,
// so a file with Windows line endings would no longer match its CSP hash and
// the page would load without CSS and JS.
const source = (name) => readFileSync(`src/${name}`, 'utf8').replace(/\r\n?/g, '\n');

// ---------- the data: every course, and the events of the one in the preview ----------

async function load(file, url) {
  if (offline) return JSON.parse(readFileSync(file, 'utf8'));
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`api.dhbw.app answered ${res.status} for ${url}`);
    const data = await res.json();
    mkdirSync('data', { recursive: true });
    writeFileSync(file, JSON.stringify(data));
    return data;
  } catch (err) {
    // a deploy shouldn't fail because the API is down: use the last saved copy
    if (!existsSync(file)) throw err;
    console.warn(`${err.message}; using ${file} from the last build`);
    return JSON.parse(readFileSync(file, 'utf8'));
  }
}

const courses = courseList(await load('data/courses.json', `${API}/courses`), await load('data/parsed.json', `${API}/courses/MA/parsed`));
const course = courses.find((c) => c.name === COURSE) || { name: COURSE, meta: '', full: '', ids: [`MA-${COURSE}`] };
// archived=true: the past weeks of the running theory phase too
const raw = await load('data/events.json', `${API}/rapla/lectures/${course.ids[0]}/events?archived=true`);
const builtAt = Date.now();
const events = normalize(raw);

// ---------- the page ----------

// The page's script: these files in this order, in one scope. render.js runs
// in the browser too (same code, without the module syntax); the others each
// define one setup function, and app.js, last, calls them.
const SCRIPTS = ['render.js', 'timetable.js', 'search.js', 'mensa.js', 'pwa.js', 'match.js', 'chat.js', 'settings.js', 'account.js', 'app.js'];
const script = `(() => {\n${SCRIPTS.map((name) => source(name).replace(/^export /gm, '')).join('\n')}\n})();`;
// The files only meet here, so this is where a name declared twice or a typo
// shows up: better a failed build than a page whose script doesn't start.
new Script(script, { filename: 'the page script (src/*.js joined)' });

// theme.js runs on its own in <head> (before the first paint); its functions
// are global, and settings.js in the page script uses them.
const theme = source('theme.js');
new Script(theme, { filename: 'src/theme.js' });

const page = {
  css: source('styles.css'),
  script,
  theme,
  main: homeHTML(courses, { sample: course.name, sampleEvents: events, now: builtAt }),
  foot: homeFooterHTML(courses, { builtAt }),
  // what the script reads: every course, and the preview's events (only the fields it uses)
  data: { courses, sample: { name: course.name, raw: raw.map(({ id, name, startTime, endTime, rooms, type }) => ({ id, name, startTime, endTime, rooms, type })) } },
};

mkdirSync('public', { recursive: true });
const html = withCsp(pageHTML({ ...page, title: TITLE }));
writeFileSync('public/index.html', html);

// ---------- installable app: icons, manifest, service worker ----------

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon.svg', iconSVG());
writeFileSync('public/icons/icon-192.png', iconPNG(192));
writeFileSync('public/icons/icon-512.png', iconPNG(512));
writeFileSync('public/icons/maskable-512.png', iconPNG(512, { rounded: false }));
writeFileSync('public/icons/apple-touch-icon.png', iconPNG(180, { rounded: false }));

const manifest = {
  id: './',
  name: TITLE,
  short_name: 'Stundenplan',
  description: 'Stundenpläne aller Kurse der DHBW Mannheim, live aus Rapla, mit Mensa. Auch offline.',
  lang: 'de',
  dir: 'ltr',
  start_url: './',
  scope: './',
  display: 'standalone',
  orientation: 'any',
  background_color: '#000000',
  theme_color: '#000000',
  categories: ['education', 'productivity'],
  icons: [
    { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};
writeFileSync('public/manifest.webmanifest', JSON.stringify(manifest, null, 2));

// a new version whenever the page or the worker changes, so browsers install the new worker
const sw = source('sw.js');
const version = createHash('sha256').update(html).update(sw).update(JSON.stringify(manifest)).digest('hex').slice(0, 12);
writeFileSync('public/sw.js', sw.replace('__VERSION__', version));

// ---------- dev page: the page against a fake API with worst-case data (break-ui) ----------

// no CSP here: the fake API comes as an inline script
writeFileSync('dev.html', pageHTML({ ...page, title: `${TITLE} (Testdaten)`, head: DEV_STYLE, tail: devTail(devData(raw, builtAt)) }));

const { block } = splitBlock(events, builtAt);
console.log(`index.html: Startseite mit ${courses.length} Kursen, Vorschau ${course.name} (${block.length} Termine in ${toWeeks(block).length} Wochen) · Stand ${hm(partsOf(builtAt))} Uhr`);
