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

  it('ignores cookie language that is not in a fixed or sticky element', () => {
    // Isolates the position guard: has cookie words AND an accept control.
    mount(`<div id="b"><p>We use cookies. Read our cookie policy.</p>
      <button>Accept</button></div>`);
    expect(hideCookieBanners(document)).toBe(0);
  });

  it('ignores a fixed bar with an accept-ish control but no cookie language', () => {
    // Isolates the cookie-language guard: fixed AND has a matching button.
    mount(`<nav id="b" style="position:fixed;z-index:500">
      <button>Accept</button> Home About Contact</nav>`);
    expect(hideCookieBanners(document)).toBe(0);
  });

  it('ignores an element too long to be a banner', () => {
    // Isolates the length cap — the guard that stops us blanking a page
    // whose whole wrapper happens to mention cookies.
    const filler = 'lorem ipsum dolor sit amet. '.repeat(80); // > 1200 chars
    mount(`<div id="b" style="position:fixed;z-index:500">
      <p>We use cookies. ${filler}</p><button>Accept</button></div>`);
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

  it('clears a fixed body position', () => {
    document.body.style.position = 'fixed';
    restoreScroll(document);
    expect(document.body.style.position).toBe('');
  });

  it('removes scroll-lock classes', () => {
    document.body.className = 'modal-open some-app-class no-scroll';
    restoreScroll(document);
    expect(document.body.classList.contains('modal-open')).toBe(false);
    expect(document.body.classList.contains('no-scroll')).toBe(false);
    // Unrelated classes must survive — we restore scrolling, not restyle.
    expect(document.body.classList.contains('some-app-class')).toBe(true);
  });

  it('never adds a restriction to an unlocked page', () => {
    document.body.style.overflow = 'auto';
    restoreScroll(document);
    expect(document.body.style.overflow).toBe('auto');
  });
});
