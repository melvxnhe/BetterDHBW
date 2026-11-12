// The settings: a button in the header that opens a small panel to pick the
// theme (Automatisch / Hell / Dunkel), the accent colour and the layout. The choice is
// kept on this device (localStorage) and applied by theme.js, which also
// applies it before the first paint on the next visit.
//
// The panel is a native popover: it closes on Escape and on a click outside,
// and focus returns to the button. It grows out of the button's corner;
// opened or closed with the keyboard it is simply there.
//
// setupSettings() needs nothing from the page and returns nothing.
function setupSettings() {
  const button = document.querySelector('[data-settings-button]');
  if (!button) return;

  const MODES = [['system', 'Automatisch'], ['light', 'Hell'], ['dark', 'Dunkel']];
  const ACCENTS = [['red', 'Rot'], ['blue', 'Blau'], ['green', 'Grün'], ['purple', 'Lila'], ['orange', 'Orange']];
  // the layouts (src/layouts.css): each a look of its own for the whole site
  const LAYOUTS = [
    ['standard', 'Standard', 'Karten und Wochenraster, hell oder dunkel.'],
    ['tafel', 'Abfahrtstafel', 'Abfahrtstafeln am Bahnhof: Fallblatt-Zeiten, Module als Linien, Räume als Gleise.'],
    ['plakat', 'Plakat', 'Wie ein Schweizer Plakat: große Schrift, schwarze Linien, nur Schwarz, Weiß und Rot.'],
    ['tageslicht', 'Tageslicht', 'Eine Sonnenuhr über deinem Tag, die Seite in der Farbe der Tageszeit.'],
  ];

  // Each swatch carries data-accent, so it shows that accent's colour with
  // the same rules as the page (light or dark included): no colour is written twice.
  const panel = document.createElement('div');
  panel.id = 'settings';
  panel.className = 'settings';
  panel.popover = 'auto';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-labelledby', 'settings-title');
  panel.innerHTML = `<h2 class="settings-title" id="settings-title">Einstellungen</h2>
<fieldset class="settings-group"><legend class="settings-label">Darstellung</legend>
<div class="segmented">${MODES.map(([value, label]) => `<label><input type="radio" name="theme-mode" value="${value}"><span>${label}</span></label>`).join('')}</div>
<p class="settings-hint">„Automatisch“ folgt deinem Gerät.</p></fieldset>
<fieldset class="settings-group"><legend class="settings-label">Akzentfarbe</legend>
<div class="swatches">${ACCENTS.map(([value, label]) => `<label class="swatch" data-accent="${value}" title="${label}"><input type="radio" name="theme-accent" value="${value}"><span class="visually-hidden">${label}</span></label>`).join('')}</div>
<p class="settings-hint">Für heute, was gerade läuft und die Prüfungen.</p></fieldset>
<fieldset class="settings-group"><legend class="settings-label">Layout</legend>
<div class="layout-list">${LAYOUTS.map(([value, label, hint]) => `<label class="layout-option"><input type="radio" name="theme-layout" value="${value}"><span class="layout-name">${label}</span><span class="layout-hint">${hint}</span></label>`).join('')}</div></fieldset>`;
  document.body.append(panel);
  button.popoverTargetElement = panel;

  const picked = (name) => panel.querySelector(`input[name="${name}"]:checked`)?.value;

  // the radios show what is applied now
  function sync() {
    const { mode, accent } = readTheme();
    panel.querySelector(`input[name="theme-mode"][value="${mode}"]`).checked = true;
    panel.querySelector(`input[name="theme-accent"][value="${accent}"]`).checked = true;
    panel.querySelector(`input[name="theme-layout"][value="${readTheme().layout}"]`).checked = true;
  }

  // Every colour changes in the same frame: transitions are off for the
  // frame of the switch (.theme-switching in styles.css).
  function apply(theme) {
    const root = document.documentElement;
    root.classList.add('theme-switching');
    applyTheme(theme);
    dispatchEvent(new CustomEvent('layoutchange')); // layouts.js adds or removes what a layout brings (clock, sky)
    getComputedStyle(document.body).color; // the new colours are computed now, with transitions off
    setTimeout(() => root.classList.remove('theme-switching'), 1); // not rAF: it never fires in a hidden tab (a storage event from another one)
  }

  panel.addEventListener('change', () => {
    const theme = { mode: picked('theme-mode'), accent: picked('theme-accent'), layout: picked('theme-layout') };
    try { localStorage.setItem(THEME_KEY, JSON.stringify(theme)); } catch { /* storage blocked: it applies until the page is closed */ }
    apply(theme);
  });

  // another tab changed it: follow
  addEventListener('storage', (e) => {
    if (e.key !== THEME_KEY) return;
    apply(readTheme());
    sync();
  });

  // ---- opening and closing ----

  // under the button, its right edge on the button's
  function place() {
    const r = button.getBoundingClientRect();
    panel.style.top = `${Math.round(r.bottom + 8)}px`;
    panel.style.right = `${Math.max(8, Math.round(innerWidth - r.right))}px`;
  }

  // detail is 0 for Enter/Space: keyboard actions are instant
  button.addEventListener('click', (e) => panel.classList.toggle('is-instant', e.detail === 0));
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') panel.classList.add('is-instant'); });

  panel.addEventListener('beforetoggle', (e) => {
    if (e.newState !== 'open') return;
    sync();
    place();
  });
  // Opened with the keyboard, the chosen mode gets focus, so the arrow keys
  // pick another right away. With a pointer focus stays put: a focus ring
  // nobody asked for would only be noise.
  panel.addEventListener('toggle', (e) => {
    if (e.newState === 'open' && panel.classList.contains('is-instant')) panel.querySelector('input[name="theme-mode"]:checked').focus({ preventScroll: true });
  });
  addEventListener('resize', () => { if (panel.matches(':popover-open')) place(); });
}
