// test/newsletter.test.js
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { looksLikeNewsletter, findNewsletterModals, dismissNewsletter } from '../src/content/newsletter.js';

const overlay = (inner) =>
  `<div id="m" style="position:fixed;z-index:9999">${inner}</div>`;

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.style.overflow = '';
  document.body.style.overflow = '';
});

const mount = (html) => {
  document.body.innerHTML = html;
  for (const el of document.querySelectorAll('*')) {
    el.getBoundingClientRect = () => ({ width: 400, height: 300 });
  }
  return document.querySelector('#m');
};

describe('looksLikeNewsletter — positives', () => {
  it('flags an overlay with an email field and subscribe copy', () => {
    const el = mount(overlay(`<h2>Join our newsletter</h2>
      <input type="email"><button>Subscribe</button>`));
    expect(looksLikeNewsletter(el)).toBe(true);
  });

  it('flags a discount-code signup', () => {
    const el = mount(overlay(`<p>Get 10% off your first order</p>
      <input type="email" placeholder="Email address"><button>Sign up</button>`));
    expect(looksLikeNewsletter(el)).toBe(true);
  });
});

describe('looksLikeNewsletter — negatives', () => {
  it('leaves a login modal alone (password field)', () => {
    const el = mount(overlay(`<h2>Sign in</h2>
      <input type="email"><input type="password"><button>Sign in</button>`));
    expect(looksLikeNewsletter(el)).toBe(false);
  });

  it('leaves a checkout form alone (too many inputs)', () => {
    const el = mount(overlay(`<h2>Subscribe & checkout</h2>
      <input type="email"><input name="a"><input name="b"><button>Go</button>`));
    expect(looksLikeNewsletter(el)).toBe(false);
  });

  it('leaves a cookie banner alone (no email field)', () => {
    const el = mount(overlay(`<p>We use cookies</p><button>Accept</button>`));
    expect(looksLikeNewsletter(el)).toBe(false);
  });

  it('leaves inline footer signup alone (not an overlay)', () => {
    document.body.innerHTML =
      `<footer id="m"><input type="email"><button>Subscribe</button></footer>`;
    for (const el of document.querySelectorAll('*')) {
      el.getBoundingClientRect = () => ({ width: 400, height: 100 });
    }
    expect(looksLikeNewsletter(document.querySelector('#m'))).toBe(false);
  });

  it('leaves a hidden overlay alone', () => {
    document.body.innerHTML = overlay(`<input type="email"><button>Subscribe</button>`);
    expect(looksLikeNewsletter(document.querySelector('#m'))).toBe(false);
  });
});

describe('dismissNewsletter', () => {
  it('prefers clicking a close control', () => {
    const el = mount(overlay(`<button aria-label="Close">x</button>
      <input type="email"><button>Subscribe</button>`));
    let clicked = false;
    el.querySelector('[aria-label=Close]').addEventListener('click', () => { clicked = true; });
    dismissNewsletter(el);
    expect(clicked).toBe(true);
  });

  it('hides the element when there is no close control', () => {
    const el = mount(overlay(`<input type="email"><button>Subscribe</button>`));
    dismissNewsletter(el);
    expect(el.style.display).toBe('none');
  });
});
