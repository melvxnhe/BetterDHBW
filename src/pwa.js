// The page as an installable app: the install button, the service worker
// (src/sw.js) that keeps opened plans for offline use, and the window an
// installed app opens in.
//
// setupPwa({ worker, onTakeover }) returns { showInstall, launchedAsApp }:
// - worker: whether to register the service worker (not on dev.html)
// - onTakeover(): the worker has just taken control of this page
// - showInstall(): shows or hides the [data-install] buttons on screen
// - launchedAsApp: this is the first page of an installed app's launch
function setupPwa({ worker, onTakeover }) {
  // ---- install ----

  // Chrome and Edge offer installing through this event; the page keeps it for
  // its own button. Safari has none: the footer says where to find it there.
  let installPrompt = null;
  function showInstall() {
    document.querySelectorAll('[data-install]').forEach((b) => { b.hidden = !installPrompt; });
  }
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    showInstall();
  });
  addEventListener('appinstalled', () => { installPrompt = null; showInstall(); });
  document.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-install]') || !installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null; // a prompt can be shown once
    showInstall();
    prompt.prompt();
    await prompt.userChoice.catch(() => null);
  });

  // ---- offline ----

  if (worker && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* no offline support, the page works as before */ });
    // The first install takes over a page whose data came past the worker, so
    // nothing is saved yet: the page fetches again (no redraw unless it changed) to save it.
    navigator.serviceWorker.addEventListener('controllerchange', onTakeover);
  }

  // ---- launch ----

  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  // once per launch: sessionStorage lasts as long as the app's window
  const firstPage = (() => { try { const first = !sessionStorage.getItem('launched'); sessionStorage.setItem('launched', '1'); return first; } catch { return false; } })();
  const launchedAsApp = standalone && firstPage;

  // On Windows and macOS an installed app opens at whatever size the browser
  // remembers. On launch it fills the work area (the taskbar stays); later
  // resizing is left alone. Chrome and Edge allow this for app windows only;
  // in a tab, and on phones, the calls do nothing.
  if (launchedAsApp && matchMedia('(pointer: fine)').matches) {
    try {
      moveTo(screen.availLeft || 0, screen.availTop || 0);
      resizeTo(screen.availWidth, screen.availHeight);
    } catch { /* not allowed here: keep the size */ }
  }

  return { showInstall, launchedAsApp };
}
