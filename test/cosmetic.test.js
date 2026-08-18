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

  describe('reviewer-probed false positives', () => {
    it('leaves a fixed nav bar alone (cookie word and accept word both live only in <a> labels)', () => {
      // Isolates nothing in isolation — it is doubly guarded (prose-scoping
      // AND button-vs-anchor both independently zero it) which is exactly
      // the shape of the original bug report, so it's kept as a literal
      // regression fixture for that report rather than a single-condition
      // probe.
      mount(`<nav id="b" style="position:fixed;z-index:500">
        Home <a>Privacy preferences</a> <a>Bookings</a></nav>`);
      expect(hideCookieBanners(document)).toBe(0);
    });

    it('leaves a fixed "Order tracking" panel alone (no longer reads "tracking" as cookie language)', () => {
      // Matches the reviewer's literal probe. "tracking" is no longer a
      // COOKIE_WORD, so mentionsCookies is false here regardless of the
      // "Book a courier" button (which, incidentally, also no longer
      // fragment-matches "ok" post word-boundary fix — belt and braces).
      mount(`<div id="b" style="position:fixed;z-index:500">
        Order tracking. <button>Book a courier</button></div>`);
      expect(hideCookieBanners(document)).toBe(0);
    });

    it('leaves a sticky footer\'s "Cookie policy" link + <button>OK</button> alone', () => {
      // Isolates the prose-scoping fix: "Cookie policy" is a real cookie
      // word, and <button>OK</button> is a real whole-word accept control,
      // but the cookie word lives only inside a link label, not in the
      // element's own prose.
      mount(`<footer id="b" style="position:sticky;z-index:500">
        <a>Cookie policy</a> <button>OK</button></footer>`);
      expect(hideCookieBanners(document)).toBe(0);
    });
  });

  describe('single-condition guard isolation', () => {
    it('requires a whole-word accept match, not a substring ("Book" must not match "ok")', () => {
      // mentionsCookies is true via plain prose ("We use cookies."), so the
      // only thing that can produce 0 here is the word-boundary check on
      // the button text "Book a courier" (old code matched the "ok"
      // fragment inside "Book").
      mount(`<div id="b" style="position:fixed;z-index:500">
        We use cookies. <button>Book a courier</button></div>`);
      expect(hideCookieBanners(document)).toBe(0);
    });

    it('does not treat "tracking" as cookie language', () => {
      // hasButton is true ("Allow" is a real whole-word accept control), so
      // the only thing that can produce 0 here is COOKIE_WORDS no longer
      // containing "tracking".
      mount(`<div id="b" style="position:fixed;z-index:500">
        Order tracking status. <button>Allow</button></div>`);
      expect(hideCookieBanners(document)).toBe(0);
    });

    it('does not count an <a> as an accept control', () => {
      // mentionsCookies is true via plain prose ("We use cookies here."),
      // so the only thing that can produce 0 here is requiring the accept
      // control to be a real button/[role=button], not an <a>.
      mount(`<div id="b" style="position:fixed;z-index:500">
        We use cookies here. <a>Accept</a></div>`);
      expect(hideCookieBanners(document)).toBe(0);
    });

    it('does not count a cookie word that only appears inside a link/button label', () => {
      // hasButton is true (<button>OK</button> is a real whole-word accept
      // control), so the only thing that can produce 0 here is scoping the
      // cookie-word scan to the element's own prose, excluding link/button
      // labels ("Cookie policy" lives only inside the <a>).
      mount(`<footer id="b" style="position:sticky;z-index:500">
        <a>Cookie policy</a> <button>OK</button></footer>`);
      expect(hideCookieBanners(document)).toBe(0);
    });

    it('requires an accept control at all — cookie language alone is not enough (hasButton isolation)', () => {
      // mentionsCookies is true via plain prose and there is no button,
      // link, or [role=button] anywhere in the element. Only the
      // mentionsCookies && hasButton conjunction can produce 0 here.
      mount(`<div id="b" style="position:fixed;z-index:500">
        We use cookies on this site to improve your experience.</div>`);
      expect(hideCookieBanners(document)).toBe(0);
    });
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
