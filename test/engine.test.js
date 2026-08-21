// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach } from 'vitest';
import { runEngine } from '../src/engine/index.js';

const BUNDLE = JSON.parse(readFileSync('src/rules/bundle.json', 'utf8'));

beforeEach(() => {
  document.body.innerHTML = readFileSync('test/fixtures/cookiebot.html', 'utf8');
  // jsdom gives every element a zero rect; make the banner "visible".
  for (const el of document.querySelectorAll('*')) {
    el.getBoundingClientRect = () => ({ width: 200, height: 50 });
  }
});

describe('runEngine on a real Cookiebot banner', () => {
  it('identifies cookiebot', async () => {
    const r = await runEngine(BUNDLE, document);
    expect(r.handled).toBe('cookiebot');
  });

  it('turns every consent category off', async () => {
    await runEngine(BUNDLE, document);
    const boxes = [...document.querySelectorAll('input[type=checkbox]')];
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.every((b) => !b.checked)).toBe(true);
  });

  it('claims a plain OneTrust banner with the rule that can act on it', async () => {
    // brooklinen.com, captured 2026-08-21. Two rules match `#onetrust-banner-sdk`:
    // `onetrust`, which has real methods, and `onetrust_banner`, which has none.
    // `onetrust` is meant to win — its detector asks for a banner with no
    // preference centre inside — and only does so if childFilterNegate is honoured.
    document.body.innerHTML = readFileSync('test/fixtures/onetrust-banner.html', 'utf8');
    for (const el of document.querySelectorAll('*')) {
      el.getBoundingClientRect = () => ({ width: 900, height: 80 });
    }
    const r = await runEngine(BUNDLE, document);
    expect(r.handled).toBe('onetrust');
  });

  it('hides the OneTrust wrapper once it has claimed the banner', async () => {
    document.body.innerHTML = readFileSync('test/fixtures/onetrust-banner.html', 'utf8');
    for (const el of document.querySelectorAll('*')) {
      el.getBoundingClientRect = () => ({ width: 900, height: 80 });
    }
    await runEngine(BUNDLE, document);
    expect(document.querySelector('#onetrust-consent-sdk').style.display).toBe('none');
  });

  it('reports no match on a page with no banner', async () => {
    document.body.innerHTML = `<p>ordinary page</p>`;
    const r = await runEngine(BUNDLE, document);
    expect(r.handled).toBe(null);
    expect(r.reason).toBe('no-cmp-detected');
  });

  it('abandons a rule that needs an unsupported action', async () => {
    const bundle = { rules: { fake: {
      detectors: [{ presentMatcher: [{ type: 'css', target: { selector: 'body' } }],
                    showingMatcher: [{ type: 'css', target: { selector: 'body' } }] }],
      methods: [{ name: 'DO_CONSENT', action: { type: 'slide' } }],
    }}};
    const r = await runEngine(bundle, document);
    expect(r.handled).toBe(null);
    expect(r.reason).toBe('unsupported-action');
  });
});
