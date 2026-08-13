// test/cosmetic.test.js
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { hideCookieBanners } from '../src/content/cosmetic.js';
import { restoreScroll } from '../src/content/scroll.js';

const mount = (html) => {
  document.body.innerHTML = html;
  for (const el of document.querySelectorAll('*')) {
    el.getBoundingClientRect = () => ({ width: 600, height: 90 });
  }
};

beforeEach(() => { document.body.innerHTML = ''; });

describe('hideCookieBanners', () => {
  it('hides a fixed banner mentioning cookies', () => {
    mount(`<div id="b" style="position:fixed;z-index:500">
      We use cookies to improve your experience. <button>Accept</button></div>`);
    expect(hideCookieBanners(document)).toBe(1);
    expect(document.querySelector('#b').style.display).toBe('none');
  });

  it('ignores body text that merely mentions cookies', () => {
    mount(`<article id="b"><p>This recipe makes 24 cookies.</p></article>`);
    expect(hideCookieBanners(document)).toBe(0);
  });

  it('ignores a fixed header with no cookie language', () => {
    mount(`<nav id="b" style="position:fixed;z-index:500">Home About Contact</nav>`);
    expect(hideCookieBanners(document)).toBe(0);
  });
});

describe('restoreScroll', () => {
  it('clears overflow hidden on body and html', () => {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    restoreScroll(document);
    expect(document.body.style.overflow).toBe('');
    expect(document.documentElement.style.overflow).toBe('');
  });
});
