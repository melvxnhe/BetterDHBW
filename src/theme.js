// The theme picked in the settings (Hell / Dunkel / Automatisch, and the
// accent colour), put on <html> before anything is drawn.
//
// Not part of the page script: build.mjs puts this file into <head> as a
// script of its own, so the saved theme applies before the first paint and a
// dark page never flashes white. As a plain script its declarations are
// global; settings.js uses them to change the theme. Colours themselves live
// in styles.css (data-theme, data-accent).

const THEME_KEY = 'dhbw-ma-darstellung'; // localStorage: { mode, accent }
const THEME_MODES = ['system', 'light', 'dark'];
const THEME_ACCENTS = ['red', 'blue', 'green', 'purple', 'orange'];
const THEME_BARS = { light: '#f5f5f7', dark: '#000000' }; // the browser's bar colour: --bg of each mode

// The saved theme, or the defaults: the device decides, red accent.
function readTheme() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(THEME_KEY)); } catch { /* storage blocked or broken: defaults */ }
  return {
    mode: THEME_MODES.includes(saved?.mode) ? saved.mode : 'system',
    accent: THEME_ACCENTS.includes(saved?.accent) ? saved.accent : 'red',
  };
}

function applyTheme({ mode, accent }) {
  const root = document.documentElement;
  root.dataset.theme = mode; // also tells the CSS that this script ran, so the settings button may show
  if (accent === 'red') delete root.dataset.accent;
  else root.dataset.accent = accent;
  // The bar colour of the browser and of the installed app: each meta follows
  // the device through its media query, so a fixed mode sets both.
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    const own = (meta.media.match(/light|dark/) || ['light'])[0];
    meta.content = THEME_BARS[mode === 'system' ? own : mode];
  });
}

applyTheme(readTheme());
