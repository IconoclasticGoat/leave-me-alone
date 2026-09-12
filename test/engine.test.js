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

  it('does not claim a rule whose methods it can never run', async () => {
    // Thirteen vendored rules are openers: their only real method is UTILITY,
    // which is not in ORDER. run() skips every method and throws nothing, so
    // the rule used to report success having done nothing at all — and the
    // sweeper takes `handled` as licence to stop, fallback included.
    const bundle = { rules: { opener: {
      detectors: [{ presentMatcher: [{ type: 'css', target: { selector: 'body' } }],
                    showingMatcher: [{ type: 'css', target: { selector: 'body' } }] }],
      methods: [{ name: 'UTILITY', action: { type: 'click', target: { selector: 'button' } } }],
    }}};
    const r = await runEngine(bundle, document);
    expect(r.handled).toBe(null);
    expect(r.reason).toBe('no-actionable-method');
  });

  it('falls through an opener to a later rule that can act', async () => {
    // The ordering that saved OneTrust on most sites is not guaranteed: an
    // opener matching first must not shut the door on a rule that works.
    document.body.innerHTML = `<div id="bar">cookies <button id="go">Reject</button></div>`;
    const bundle = { rules: {
      opener: {
        detectors: [{ presentMatcher: [{ type: 'css', target: { selector: 'body' } }],
                    showingMatcher: [{ type: 'css', target: { selector: 'body' } }] }],
        methods: [{ name: 'UTILITY', action: { type: 'click', target: { selector: '#go' } } }],
      },
      real: {
        detectors: [{ presentMatcher: [{ type: 'css', target: { selector: 'body' } }],
                    showingMatcher: [{ type: 'css', target: { selector: 'body' } }] }],
        methods: [{ name: 'HIDE_CMP', action: { type: 'hide', target: { selector: '#bar' } } }],
      },
    }};
    const r = await runEngine(bundle, document);
    expect(r.handled).toBe('real');
    expect(document.querySelector('#bar').style.display).toBe('none');
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

describe('runEngine on the cookieconsent library (local rule)', () => {
  // neighborhoodscout.com, captured 2026-09-06. The open-source cookieconsent
  // 3.x banner: no vendored rule detects it, and the cosmetic fallback could
  // not see its "Got it!" either — an <a role="button"> with no href. The
  // library persists a click as a year-long cookie, so clicking beats hiding:
  // hidden, the banner re-renders on every page load; dismissed, it is gone.
  const load = (html = readFileSync('test/fixtures/cookieconsent-v3.html', 'utf8')) => {
    document.body.innerHTML = html;
    for (const el of document.querySelectorAll('*')) {
      el.getBoundingClientRect = () => ({ width: 900, height: 80 });
    }
  };

  it('claims the banner with the local cookieconsent rule', async () => {
    load();
    const r = await runEngine(BUNDLE, document);
    expect(r.handled).toBe('cookieconsent');
  });

  it('clicks "Got it!" on an info-type banner and hides the window', async () => {
    load();
    const clicked = [];
    document.querySelector('.cc-window').addEventListener('click', (e) => clicked.push(e.target.className));
    await runEngine(BUNDLE, document);
    expect(clicked).toEqual(['cc-btn cc-dismiss']);
    expect(document.querySelector('.cc-window').style.display).toBe('none');
  });

  it('clicks Decline, never Allow, on an opt-in banner', async () => {
    // The library's opt-in/opt-out compliance block: {{deny}}{{allow}}.
    load(readFileSync('test/fixtures/cookieconsent-v3.html', 'utf8').replace(
      '<div class="cc-compliance"><a aria-label="dismiss cookie message" role="button" tabindex="0" class="cc-btn cc-dismiss">Got it!</a></div>',
      '<div class="cc-compliance cc-highlight">'
        + '<a aria-label="deny cookies" role="button" tabindex="0" class="cc-btn cc-deny">Decline</a>'
        + '<a aria-label="allow cookies" role="button" tabindex="0" class="cc-btn cc-allow">Allow cookies</a></div>',
    ));
    expect(document.querySelector('.cc-allow')).not.toBeNull(); // the replace took
    const clicked = [];
    document.querySelector('.cc-window').addEventListener('click', (e) => clicked.push(e.target.className));
    await runEngine(BUNDLE, document);
    expect(clicked).toEqual(['cc-btn cc-deny']);
  });

  it('does not fire on a .cc-window that is not the cookieconsent library', async () => {
    // Springer Nature's banner also uses cc-* class names; the aria-label the
    // library stamps on its dialog is the discriminator.
    load(`<div class="cc-window cc-banner" style="position:fixed">We use cookies.
      <a role="button" class="cc-btn cc-dismiss">Got it!</a></div>`);
    const r = await runEngine(BUNDLE, document);
    expect(r.handled).not.toBe('cookieconsent');
  });
});
