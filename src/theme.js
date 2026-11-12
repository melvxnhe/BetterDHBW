// The theme picked in the settings (Hell / Dunkel / Automatisch, the accent
// colour and the layout), put on <html> before anything is drawn.
//
// Not part of the page script: build.mjs puts this file into <head> as a
// script of its own, so the saved theme applies before the first paint and a
// dark page never flashes white. As a plain script its declarations are
// global; settings.js uses them to change the theme. Colours themselves live
// in styles.css (data-theme, data-accent).

const THEME_KEY = 'dhbw-ma-darstellung'; // localStorage: { mode, accent }
const THEME_MODES = ['system', 'light', 'dark'];
const THEME_ACCENTS = ['red', 'blue', 'green', 'purple', 'orange'];
// the layouts (src/layouts.css, src/layouts.js): the standard one, and three of their own
const THEME_LAYOUTS = ['standard', 'tafel', 'plakat', 'tageslicht'];
const THEME_BARS = { light: '#f5f5f7', dark: '#000000' }; // the browser's bar colour: --bg of each mode
const LAYOUT_BARS = { tafel: '#0b0d10', plakat: { light: '#ffffff', dark: '#000000' } }; // tageslicht sets its own, by the hour

// The saved theme, or the defaults: the device decides, red accent.
function readTheme() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(THEME_KEY)); } catch { /* storage blocked or broken: defaults */ }
  // ?layout=tafel shows a layout for this visit without saving it: to try one, or to show someone
  const asked = new URLSearchParams(location.search).get('layout');
  return {
    mode: THEME_MODES.includes(saved?.mode) ? saved.mode : 'system',
    accent: THEME_ACCENTS.includes(saved?.accent) ? saved.accent : 'red',
    layout: THEME_LAYOUTS.includes(asked) ? asked : THEME_LAYOUTS.includes(saved?.layout) ? saved.layout : 'standard',
  };
}

function applyTheme({ mode, accent, layout = 'standard' }) {
  const root = document.documentElement;
  root.dataset.theme = mode; // also tells the CSS that this script ran, so the settings button may show
  if (accent === 'red') delete root.dataset.accent;
  else root.dataset.accent = accent;
  if (layout === 'standard') delete root.dataset.layout;
  else root.dataset.layout = layout;
  // The bar colour of the browser and of the installed app: each meta follows
  // the device through its media query, so a fixed mode sets both. A layout
  // with a ground of its own sets that.
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    const own = (meta.media.match(/light|dark/) || ['light'])[0];
    const effective = mode === 'system' ? own : mode;
    const bar = LAYOUT_BARS[layout];
    meta.content = typeof bar === 'string' ? bar : bar ? bar[effective] : THEME_BARS[effective];
  });
}

applyTheme(readTheme());
