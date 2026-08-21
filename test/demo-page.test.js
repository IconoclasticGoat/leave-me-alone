// test/demo-page.test.js
// @vitest-environment jsdom
//
// demo/index.html is the backdrop for the Chrome Web Store screenshots, and
// the whole point of shooting against it rather than a mockup is that the
// shipping heuristics really do act on it. That claim rots the moment someone
// rewords the copy: drop "cookies" out of the prose, or let the word
// "register" into the modal, and the page quietly stops being handled while
// still looking identical in a screenshot.
//
// These tests are the tripwire for that. They are asserting a property of a
// *marketing asset*, which is unusual, and deliberate.
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach } from 'vitest';
import { hideCookieBanners } from '../src/content/cosmetic.js';
import { findNewsletterModals } from '../src/content/newsletter.js';

const HTML = readFileSync('demo/index.html', 'utf8');

beforeEach(() => {
  document.documentElement.innerHTML = HTML;
  // jsdom does no layout, so every element measures 0x0 and isShown() would
  // reject the lot. The same stub the other DOM suites use.
  for (const el of document.querySelectorAll('*')) {
    el.getBoundingClientRect = () => ({ width: 600, height: 90 });
  }
});

describe('the demo page used for store screenshots', () => {
  it('has a cookie bar the cosmetic fallback actually hides', () => {
    expect(hideCookieBanners(document)).toBe(1);
    expect(document.querySelector('#cookie-bar').style.display).toBe('none');
  });

  it('has a newsletter modal the heuristic actually matches', () => {
    const found = findNewsletterModals(document);
    expect(found.map((el) => el.id)).toContain('newsletter');
  });

  // A third test spelling out the AUTH_MARKERS veto was written and removed.
  // It re-listed the marker strings by hand, and the hand-written list drifted
  // from the real one immediately: seeded with "Create an account", it passed
  // while the test above went red, because it was looking for the substring
  // "create account". A duplicate list that can disagree with the real one is
  // worse than no test, and the case above already covers the behaviour.
});
