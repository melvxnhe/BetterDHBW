// What a layout brings beyond its stylesheet (src/layouts.css): the
// Abfahrtstafel's station clock in the header, and the Tageslicht sky that
// follows the hour, with the sun on the course page's horizon. Which layout
// is on is data-layout on <html> (theme.js); settings.js fires "layoutchange"
// when it changes.
//
// setupLayouts() returns { page }: page() is called after every view swap.
function setupLayouts() {
  const layout = () => document.documentElement.dataset.layout || 'standard';
  const fClock = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const fHour = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const hourOf = (t) => { const [h, m] = fHour.format(t).split(':').map(Number); return h + m / 60; };

  // ---------- Abfahrtstafel: the station clock, ticking in the header ----------

  let clockTimer = null;

  function clock() {
    clearInterval(clockTimer);
    clockTimer = null;
    let el = document.querySelector('.bar-clock');
    if (layout() !== 'tafel') { el?.remove(); return; }
    if (!el) {
      el = document.createElement('span');
      el.className = 'bar-clock';
      el.setAttribute('aria-hidden', 'true');
      document.querySelector('.bar-actions')?.prepend(el);
    }
    const tick = () => { el.textContent = fClock.format(new Date()); };
    tick();
    clockTimer = setInterval(() => { if (!document.hidden) tick(); }, 1000);
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
      strip();
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
    strip();
  }

  // The horizon on the course page: the day from 6 to 22, the sun (or moon)
  // where the time is now, today's lectures as marks on the ground.
  function strip() {
    document.querySelector('.sky-strip')?.remove();
    if (layout() !== 'tageslicht') return;
    const intro = document.querySelector('main .intro');
    if (!intro) return;
    const along = (t) => `${(Math.max(0, Math.min(1, (hourOf(t) - 6) / 16)) * 100).toFixed(2)}%`;
    const ticks = [...document.querySelectorAll('.day.is-today .session[data-start]')].map((s) =>
      `<i class="sky-tick" style="--a: ${along(+s.dataset.start)}; --b: ${along(+s.dataset.end)}"></i>`).join('');
    const hours = [[6, 0], [12, 37.5], [18, 75], [22, 100]].map(([h, x]) => `<span class="sky-hour" style="--x: ${x}%">${h}</span>`).join('');
    const el = document.createElement('div');
    el.className = 'sky-strip';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = `${hours}<i class="sky-body"></i>${ticks}`;
    intro.append(el);
  }

  addEventListener('layoutchange', () => { clock(); sky(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sky(); });
  setInterval(sky, 60000); // the sky moves on with the clock
  clock();
  sky();

  return {
    page() {
      if (layout() === 'tafel') clock(); // the header is the same element, but the bar's children may be redrawn
      strip();
    },
  };
}
