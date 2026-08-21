// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSweeper } from '../src/content/index.js';

const EMPTY_BUNDLE = { rules: {} };
const ON = { cookieBanners: true, newsletters: true, pausedSites: [] };

const mount = (html) => {
  document.body.innerHTML = html;
  for (const el of document.querySelectorAll('*')) {
    el.getBoundingClientRect = () => ({ width: 400, height: 300 });
  }
};

beforeEach(() => { document.body.innerHTML = ''; });

describe('sweeper', () => {
  it('dismisses a newsletter modal when the toggle is on', async () => {
    mount(`<div id="m" style="position:fixed;z-index:9999">
      <h2>Join our newsletter</h2><input type="email"><button>Subscribe</button></div>`);
    await createSweeper({ settings: ON, bundle: EMPTY_BUNDLE }).sweep();
    expect(document.querySelector('#m').style.display).toBe('none');
  });

  it('leaves it alone when the newsletter toggle is off', async () => {
    mount(`<div id="m" style="position:fixed;z-index:9999">
      <h2>Join our newsletter</h2><input type="email"><button>Subscribe</button></div>`);
    await createSweeper({
      settings: { ...ON, newsletters: false }, bundle: EMPTY_BUNDLE,
    }).sweep();
    expect(document.querySelector('#m').style.display).toBe('');
  });

  it('restores scroll after dismissing something', async () => {
    document.body.style.overflow = 'hidden';
    mount(`<div id="m" style="position:fixed;z-index:9999">
      <h2>Newsletter</h2><input type="email"><button>Subscribe</button></div>`);
    document.body.style.overflow = 'hidden';
    await createSweeper({ settings: ON, bundle: EMPTY_BUNDLE }).sweep();
    expect(document.body.style.overflow).toBe('');
  });

  it('stops sweeping a domain after two consecutive errors', async () => {
    const engine = vi.fn(async () => { throw new Error('boom'); });
    const s = createSweeper({ settings: ON, bundle: EMPTY_BUNDLE, engine });
    await s.sweep(); await s.sweep(); await s.sweep();
    expect(engine).toHaveBeenCalledTimes(2);
    expect(s.tripped).toBe(true);
  });

  // This pair is the guard for the engine/fallback exclusivity. Same fixture,
  // opposite engine results, opposite outcomes — neither test means anything
  // without the other, and together they fail if the branches are merged.
  it('falls back to hiding when the engine found nothing', async () => {
    mount(`<div id="b" style="position:fixed;z-index:500">
      We use cookies. <button>Accept</button></div>`);
    const engine = vi.fn(async () => ({ handled: null, reason: 'no-cmp-detected' }));
    await createSweeper({ settings: ON, bundle: EMPTY_BUNDLE, engine }).sweep();
    expect(document.querySelector('#b').style.display).toBe('none');
  });

  it('does not also hide banners when the engine handled one', async () => {
    mount(`<div id="b" style="position:fixed;z-index:500">
      We use cookies. <button>Accept</button></div>`);
    const engine = vi.fn(async () => ({ handled: 'somecmp', reason: 'ok' }));
    await createSweeper({ settings: ON, bundle: EMPTY_BUNDLE, engine }).sweep();
    expect(document.querySelector('#b').style.display).toBe('');
  });

  it('survives a newsletter scan that throws', async () => {
    mount(`<div id="x">ordinary</div>`);
    const engine = vi.fn(async () => ({ handled: null, reason: 'no-cmp-detected' }));
    const boom = () => { throw new Error('hostile DOM'); };
    const original = document.querySelectorAll;
    document.querySelectorAll = boom;
    const s = createSweeper({ settings: ON, bundle: EMPTY_BUNDLE, engine });
    try {
      await expect(s.sweep()).resolves.toBeUndefined();
    } finally {
      document.querySelectorAll = original;
    }
  });
});

// start() schedules sweeps; every test below drives it through fake timers and
// counts calls to a stubbed sweep. `state.sweep()` is looked up on the object
// at call time, so replacing s.sweep after construction is enough to observe
// scheduling without running a real sweep.
describe('sweeper scheduling', () => {
  // Every started sweeper holds a live MutationObserver on this document, and
  // jsdom keeps one document for the whole file. Left running, a sweeper from
  // an earlier test reacts to a later test's DOM and corrupts its counts.
  const live = [];
  const startSpied = (opts = {}) => {
    const s = createSweeper({ settings: ON, bundle: EMPTY_BUNDLE, ...opts });
    const sweep = vi.fn(async () => {});
    s.sweep = sweep;
    s.start();
    live.push(s);
    sweep.mockClear(); // start()'s own opening sweep is not what we are counting
    return { s, sweep };
  };

  // One childList mutation, delivered to the observer as a microtask.
  const mutate = async () => {
    document.body.appendChild(document.createElement('div'));
    await Promise.resolve();
  };

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { live.splice(0).forEach((s) => s.stop()); vi.useRealTimers(); });

  it('sweeps 300ms after the page settles', async () => {
    const { sweep } = startSpied();
    await mutate();
    await vi.advanceTimersByTimeAsync(299);
    expect(sweep).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(sweep).toHaveBeenCalledTimes(1);
  });

  it('sweeps within a second even while mutations keep arriving', async () => {
    // The starvation case: an unbounded debounce is reset by every mutation,
    // so a page that mutates faster than 300ms never sweeps at all.
    const { sweep } = startSpied();
    for (let i = 0; i < 15; i += 1) {
      await mutate();
      await vi.advanceTimersByTimeAsync(200);
    }
    expect(sweep).toHaveBeenCalled();
  });

  it('runs the pending sweep when the observer shuts down', async () => {
    // stop() used to clearTimeout the scheduled sweep, so the observer's last
    // act was to discard its own outstanding work.
    const { s, sweep } = startSpied();
    await mutate();
    s.stop();
    await Promise.resolve();
    expect(sweep).toHaveBeenCalledTimes(1);
  });

  it('keeps watching a page that is still mutating past the quiet deadline', async () => {
    // QUIET_MS is a quiet period, not a fixed lifetime: a page busy at 9s must
    // still be watched at 25s.
    const { sweep } = startSpied();
    for (let i = 0; i < 5; i += 1) {
      await mutate();
      await vi.advanceTimersByTimeAsync(5_000);
    }
    sweep.mockClear();
    await mutate();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sweep).toHaveBeenCalled();
  });

  it('gives up on a page that never goes quiet', async () => {
    // The counterweight to the reset above — an animating page must not hold
    // an observer open forever.
    const { sweep } = startSpied();
    for (let i = 0; i < 14; i += 1) {
      await mutate();
      await vi.advanceTimersByTimeAsync(5_000);
    }
    sweep.mockClear();
    await mutate();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sweep).not.toHaveBeenCalled();
  });

  it('stops sweeping once the page goes quiet', async () => {
    const { sweep } = startSpied();
    await mutate();
    await vi.advanceTimersByTimeAsync(11_000);
    sweep.mockClear();
    await mutate();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sweep).not.toHaveBeenCalled();
  });
});

// A consent frame can be revealed with no mutation in this document at all —
// by a stylesheet, or by the frame's own content arriving. Layout is the one
// thing that must happen for it to become visible, so these two signals sit
// outside the MutationObserver entirely.
describe('sweeper watching consent frames', () => {
  const CMP = 'https://cdn.privacy-mgmt.com/us_pm/index.html';
  let resizeTargets;

  beforeEach(() => {
    vi.useFakeTimers();
    resizeTargets = [];
    globalThis.ResizeObserver = class {
      constructor(cb) { this.cb = cb; }
      observe(el) { resizeTargets.push({ el, fire: () => this.cb([{ target: el }], this) }); }
      disconnect() {}
    };
  });
  afterEach(() => {
    live.splice(0).forEach((s) => s.stop());
    vi.useRealTimers();
    delete globalThis.ResizeObserver;
  });

  const live = [];
  const startSpied = () => {
    const s = createSweeper({ settings: ON, bundle: EMPTY_BUNDLE });
    const sweep = vi.fn(async () => {});
    s.sweep = sweep;
    s.start();
    live.push(s);
    sweep.mockClear();
    return { s, sweep };
  };

  it('sweeps when a consent frame changes size', async () => {
    mount(`<div style="position:fixed"><iframe id="f" src="${CMP}"></iframe></div>`);
    const { sweep } = startSpied();
    expect(resizeTargets).toHaveLength(1);
    resizeTargets[0].fire();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sweep).toHaveBeenCalled();
  });

  it('sweeps when a consent frame finishes loading', async () => {
    mount(`<div style="position:fixed"><iframe id="f" src="${CMP}"></iframe></div>`);
    const { sweep } = startSpied();
    document.querySelector('#f').dispatchEvent(new Event('load'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sweep).toHaveBeenCalled();
  });

  it('does not watch a frame from an origin that is not a known consent host', async () => {
    // Isolates the allowlist: identical shape, non-consent origin. Watching
    // every third-party frame on the page is the cost this avoids.
    mount(`<div style="position:fixed"><iframe id="f" src="https://checkout.stripe.com/pay/cs_1"></iframe></div>`);
    const { sweep } = startSpied();
    expect(resizeTargets).toHaveLength(0);
    document.querySelector('#f').dispatchEvent(new Event('load'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sweep).not.toHaveBeenCalled();
  });

  it('watches a consent frame that appears after the sweeper started', async () => {
    const { sweep } = startSpied();
    mount(`<div style="position:fixed"><iframe id="f" src="${CMP}"></iframe></div>`);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_000);
    sweep.mockClear();
    expect(resizeTargets).toHaveLength(1);
    resizeTargets[0].fire();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sweep).toHaveBeenCalled();
  });

  it('watches each consent frame once, however many sweeps run', async () => {
    mount(`<div style="position:fixed"><iframe id="f" src="${CMP}"></iframe></div>`);
    startSpied();
    for (let i = 0; i < 3; i += 1) {
      document.body.appendChild(document.createElement('div'));
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(resizeTargets).toHaveLength(1);
  });

  it('starts without a ResizeObserver', () => {
    delete globalThis.ResizeObserver;
    mount(`<div style="position:fixed"><iframe id="f" src="${CMP}"></iframe></div>`);
    expect(() => createSweeper({ settings: ON, bundle: EMPTY_BUNDLE }).start()).not.toThrow();
  });
});
