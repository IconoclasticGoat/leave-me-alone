import { getSettings, isPaused } from '../settings.js';
import { runEngine } from '../engine/index.js';
import { hideCookieBanners, isCmpFrame } from './cosmetic.js';
import { findNewsletterModals, dismissNewsletter } from './newsletter.js';
import { restoreScroll } from './scroll.js';
import bundle from '../rules/bundle.json';

const DEBOUNCE_MS = 300;
// Churn may defer a sweep, but only this far. An unbounded debounce is reset
// by every mutation, so a page mutating faster than DEBOUNCE_MS never sweeps
// at all — the deadline arrives having run nothing.
const MAX_WAIT_MS = 1_000;
// Measured from the last mutation, not from document_idle: a CMP that waits
// on a network round trip must not fall off the end of a fixed lifetime.
const QUIET_MS = 10_000;
// The counterweight to that reset — an animating page must not hold an
// observer open for the life of the tab.
const MAX_LIFE_MS = 60_000;
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
      let pendingSince = 0;
      let quiet = null;
      let life = null;
      const watched = new WeakSet();

      function run() {
        clearTimeout(timer);
        timer = null;
        pendingSince = 0;
        state.sweep();
      }

      function schedule() {
        watchFrames();
        if (!pendingSince) pendingSince = Date.now();
        clearTimeout(timer);
        const cap = pendingSince + MAX_WAIT_MS - Date.now();
        timer = setTimeout(run, Math.max(0, Math.min(DEBOUNCE_MS, cap)));
        clearTimeout(quiet);
        quiet = setTimeout(() => state.stop(), QUIET_MS);
      }

      // A consent frame can be revealed with no mutation in this document at
      // all — by a stylesheet, or by the frame's own content arriving. Layout
      // is the one thing that must happen for it to become visible, so watch
      // the frame rather than wait for a mutation that may never come. Scoped
      // to allowlisted consent origins: watching every third-party frame on
      // the page would cost far more than it is worth.
      function watchFrames() {
        let frames;
        try {
          frames = root.querySelectorAll?.('iframe[src]') ?? [];
        } catch {
          return; // a hostile DOM must not break the scheduler
        }
        for (const frame of frames) {
          if (watched.has(frame) || !isCmpFrame(frame)) continue;
          watched.add(frame);
          frame.addEventListener('load', schedule);
          if (typeof ResizeObserver === 'function') {
            try { new ResizeObserver(schedule).observe(frame); } catch { /* never break the page */ }
          }
        }
      }

      const observer = new MutationObserver(schedule);
      observer.observe(root.body ?? root, { childList: true, subtree: true });

      state.stop = () => {
        observer.disconnect();
        clearTimeout(quiet);
        clearTimeout(life);
        // Never discard an outstanding sweep: shutting down used to clear the
        // pending timer, so a mutation just before the deadline was lost.
        if (pendingSince) run();
        else clearTimeout(timer);
      };

      life = setTimeout(() => state.stop(), MAX_LIFE_MS);
      quiet = setTimeout(() => state.stop(), QUIET_MS);
      watchFrames();
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
