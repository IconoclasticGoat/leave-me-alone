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
