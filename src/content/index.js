import { getSettings, isPaused } from '../settings.js';
import { runEngine } from '../engine/index.js';
import { hideCookieBanners } from './cosmetic.js';
import { findNewsletterModals, dismissNewsletter } from './newsletter.js';
import { restoreScroll } from './scroll.js';
import bundle from '../rules/bundle.json';

const QUIET_MS = 10_000;
const DEBOUNCE_MS = 300;
const MAX_ERRORS = 2;

export function createSweeper({ settings, bundle, root = document, engine = runEngine }) {
  const state = {
    tripped: false,
    errors: 0,
    handled: false,
    // Rules that opened a CMP but have not resolved it. They stay matchable,
    // so without this the next sweep would run the same rule again instead of
    // letting the rule for the panel it opened take over.
    staged: new Set(),

    async sweep() {
      if (state.tripped) return;
      let didSomething = false;

      if (settings.cookieBanners && !state.handled) {
        try {
          const r = await engine(bundle, root, { skip: state.staged });
          state.errors = 0;
          if (r.handled) {
            state.handled = true;
            didSomething = true;
          } else if (r.reason === 'staged') {
            // A rule opened the CMP's options but has not resolved it. Hiding
            // now — cosmetically or otherwise — would bury the panel the next
            // rule needs to see, so do neither and wait for the next sweep.
            state.staged.add(r.cmp);
            didSomething = true;
          } else {
            // Either no rule matched, or one matched but hit an action we
            // don't implement. Both fall back to hiding — and note the
            // fallback runs ONLY here, never alongside a successful rule.
            didSomething = hideCookieBanners(root) > 0;
          }
        } catch {
          state.errors += 1;
          if (state.errors >= MAX_ERRORS) state.tripped = true;
        }
      }

      if (settings.newsletters) {
        try {
          for (const el of findNewsletterModals(root)) {
            try { dismissNewsletter(el); didSomething = true; } catch { /* never break the page */ }
          }
        } catch { /* a hostile DOM must not escape the sweep */ }
      }

      if (didSomething) {
        try {
          restoreScroll(root.ownerDocument ?? document);
        } catch { /* nothing here is worth breaking a page for */ }
      }
    },

    start() {
      let timer = null;
      let quiet = null;
      const observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(() => state.sweep(), DEBOUNCE_MS);
      });
      observer.observe(root.body ?? root, { childList: true, subtree: true });
      state.stop = () => { observer.disconnect(); clearTimeout(timer); clearTimeout(quiet); };
      quiet = setTimeout(() => state.stop(), QUIET_MS);
      state.sweep();
    },

    stop() {},
  };
  return state;
}

async function main() {
  const settings = await getSettings();
  if (isPaused(settings, location.hostname)) return;
  createSweeper({ settings, bundle }).start();
}

if (typeof chrome !== 'undefined' && chrome.storage) main();
