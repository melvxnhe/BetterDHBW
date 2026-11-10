// The mensa card: fetched once, then hourly, and drawn into every
// [data-mensa] slot on the page (the homepage and each plan have one).
//
// setupMensa() returns { render, load, expire }:
// - render(): draws what is known into the slots on screen
// - load(): fetches /api/mensa if it's due, then renders
// - expire(): makes the next load() fetch (the network is back, …)
function setupMensa() {
  const REFRESH = 60 * 60 * 1000;
  const RETRY = 5 * 60 * 1000; // after a failure, or when the answer was a saved copy
  const state = { data: null, due: 0, pick: null, loading: false };

  // Redraws only when something would change (a new day, a new pick, new
  // dishes), so the minute tick doesn't rebuild the card or steal focus.
  function render() {
    document.querySelectorAll('[data-mensa]').forEach((slot) => {
      if (!state.data) { slot.hidden = true; return; }
      const html = mensaHTML(state.data, { now: Date.now(), pick: state.pick });
      if (slot.dataset.drawn === html) return;
      const focused = slot.contains(document.activeElement) ? document.activeElement.dataset.mensaDay : null;
      slot.innerHTML = html;
      slot.dataset.drawn = html;
      slot.hidden = false;
      if (focused) slot.querySelector(`[data-mensa-day="${focused}"]`)?.focus({ preventScroll: true });
    });
  }

  async function load() {
    if (state.loading || document.hidden || Date.now() < state.due) return;
    state.loading = true;
    state.due = Date.now() + REFRESH;
    try {
      const res = await fetch('api/mensa', { headers: { Accept: 'application/json' } });
      if (!res.ok || !res.headers.has('x-dhbw-proxy')) throw new Error('no mensa');
      state.data = await res.json();
      if (res.headers.has('x-sw-offline')) state.due = Date.now() + RETRY;
    } catch {
      if (!state.data) state.due = Date.now() + RETRY; // nothing to show yet; with a card on screen, the next hour is soon enough
    } finally {
      state.loading = false;
      render();
    }
  }

  // A picked day stays picked; once it has passed, the card is back on the next one.
  document.addEventListener('click', (e) => {
    const button = e.target.closest('[data-mensa-day]');
    if (!button) return;
    state.pick = button.dataset.mensaDay;
    render();
  });

  return { render, load, expire() { state.due = 0; } };
}
