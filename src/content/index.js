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

    async sweep() {
      if (state.tripped) return;
      let didSomething = false;

      if (settings.cookieBanners && !state.handled) {
        try {
          const r = await engine(bundle, root);
          state.errors = 0;
          if (r.handled) {
            state.handled = true;
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
        for (const el of findNewsletterModals(root)) {
          try { dismissNewsletter(el); didSomething = true; } catch { /* never break the page */ }
        }
      }

      if (didSomething) restoreScroll(root.ownerDocument ?? document);
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
