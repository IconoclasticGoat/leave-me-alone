// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
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
