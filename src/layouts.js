// What a layout brings beyond its stylesheet (src/layouts.css) and its
// course page (src/views.js): the Abfahrtstafel's clock over the boards, and
// the Tageslicht sky that follows the hour, with a greeting and the sun on
// the course page's dial. Which layout is on is data-layout on <html>
// (theme.js); settings.js fires "layoutchange" when it changes.
//
// setupLayouts() returns { page }: page() is called after the course page
// or any other view is drawn.
function setupLayouts() {
  const layout = () => document.documentElement.dataset.layout || 'standard';
  const fClock = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const fHour = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const hourOf = (t) => { const [h, m] = fHour.format(t).split(':').map(Number); return h + m / 60; };

  // ---------- Abfahrtstafel: the clock over the boards, with seconds ----------

  let clockTimer = null;

  function clock() {
    clearInterval(clockTimer);
    clockTimer = null;
    const el = document.querySelector('[data-clock]');
    if (!el || layout() !== 'tafel') return;
    const tick = () => { el.textContent = fClock.format(new Date()); };
    tick();
    clockTimer = setInterval(() => { if (!document.hidden && el.isConnected) tick(); }, 1000);
  }

  // ---------- Tageslicht: the sky by the hour ----------

  // the sky over a day, as keyframes: [hour, colour at the top, colour at the
  // bottom, whether the text on it is light or dark]; between them it blends
  const SKY = [
    [0, '#060a1e', '#141a3c', 'dark'], [5, '#101b4a', '#2b2c5e', 'dark'], [6.5, '#3b4f93', '#f3a461', 'dark'],
    [8, '#8cc4ff', '#fff0d8', 'light'], [11, '#bde2ff', '#ffffff', 'light'], [15, '#ffe6b5', '#ffffff', 'light'],
    [17.5, '#ffb06e', '#ffd8a6', 'light'], [19.5, '#c25a3d', '#3b2a68', 'dark'], [21, '#2a2552', '#141a3c', 'dark'],
    [24, '#060a1e', '#141a3c', 'dark'],
  ];
  const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const mix = (a, b, t) => `#${rgb(a).map((v, i) => Math.round(v + (rgb(b)[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;

  function skyAt(h) {
    let i = SKY.findIndex((k) => k[0] > h);
    if (i < 1) i = SKY.length - 1;
    const [h0, top0, bottom0, ink0] = SKY[i - 1], [h1, top1, bottom1, ink1] = SKY[i];
    const t = (h - h0) / (h1 - h0);
    return { top: mix(top0, top1, t), bottom: mix(bottom0, bottom1, t), ink: t < 0.5 ? ink0 : ink1 };
  }

  // the sun from 6 to 22 along an arc over the horizon; at night the moon
  // walks the same arc from 22 to 6
  const arc = (h) => {
    const day = h >= 6 && h < 22;
    const x = day ? (h - 6) / 16 : ((h + 2) % 24) / 8;
    return { body: day ? 'sun' : 'moon', x, y: Math.sin(Math.PI * x) };
  };

  function sky() {
    const root = document.documentElement;
    if (layout() !== 'tageslicht') {
      ['--sky-top', '--sky-bottom', '--sun-x', '--sun-y'].forEach((v) => root.style.removeProperty(v));
      delete root.dataset.sky;
      delete root.dataset.skyBody;
      return;
    }
    const h = hourOf(Date.now());
    const s = skyAt(h), a = arc(h);
    root.style.setProperty('--sky-top', s.top);
    root.style.setProperty('--sky-bottom', s.bottom);
    root.style.setProperty('--sun-x', `${(a.x * 100).toFixed(2)}%`);
    root.style.setProperty('--sun-y', a.y.toFixed(3));
    root.dataset.sky = s.ink;
    root.dataset.skyBody = a.body;
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => { meta.content = s.top; });
    dial();
  }

  // The course page's dial (views.js): the sun on its arc where the time is
  // now, if the dial shows today and it is day; the greeting over the title.
  const GREETINGS = [[5, 'Guten Morgen'], [11, 'Guten Tag'], [17, 'Guten Abend'], [22, 'Gute Nacht']];

  function dial() {
    if (layout() !== 'tageslicht') return;
    const h = hourOf(Date.now());
    const greet = document.querySelector('[data-greeting]');
    if (greet) greet.textContent = (GREETINGS.findLast(([from]) => h >= from) || GREETINGS.at(-1))[1];
    const sun = document.querySelector('[data-sun]');
    if (!sun) return;
    const today = sun.closest('[data-dial]')?.dataset.dial === keyOf(partsOf(Date.now()));
    if (!today || h < 6 || h >= 22) { sun.setAttribute('hidden', ''); return; }
    const t = (h - 6) / 16; // same circle as the arc in views.js: centre 200/200, radius 180
    sun.setAttribute('cx', (200 - 180 * Math.cos(Math.PI * t)).toFixed(1));
    sun.setAttribute('cy', (200 - 180 * Math.sin(Math.PI * t)).toFixed(1));
    sun.removeAttribute('hidden');
  }

  addEventListener('layoutchange', () => { clock(); sky(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sky(); });
  setInterval(sky, 60000); // the sky moves on with the clock
  clock();
  sky();

  return {
    page() {
      clock();
      dial();
    },
  };
}
