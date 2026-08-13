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

  it('leaves a passwordless magic-link sign-in alone', () => {
    // All three positive signals present and no password field, yet this is
    // an auth flow. Dismissing it would break the site's login.
    const el = mount(overlay(`<h2>Sign up or log in</h2>
      <p>We'll email you a magic link.</p>
      <input type="email"><button>Continue</button>`));
    expect(looksLikeNewsletter(el)).toBe(false);
  });

  it('leaves an OAuth account overlay alone', () => {
    const el = mount(overlay(`<h2>Sign up for 10% off</h2>
      <button>Continue with Google</button>
      <input type="email"><button>Sign up</button>`));
    expect(looksLikeNewsletter(el)).toBe(false);
  });

  it('leaves an overlay offering an existing-account path alone', () => {
    const el = mount(overlay(`<h2>Join us</h2><input type="email">
      <button>Sign up</button><a>Already have an account?</a>`));
    expect(looksLikeNewsletter(el)).toBe(false);
  });

  it('leaves a username-autocomplete field alone', () => {
    const el = mount(overlay(`<h2>Subscribe</h2>
      <input type="email" autocomplete="username"><button>Go</button>`));
    expect(looksLikeNewsletter(el)).toBe(false);
  });

  it('leaves an account signup whose only marketing word is "sign up"', () => {
    // Phrased to dodge every AUTH_MARKER. It survives because "sign up" is
    // not a positive signal on its own — the phrase is shared with
    // registration forms and cannot tell them apart.
    const el = mount(overlay(`<h2>New here?</h2>
      <p>Sign up and we'll email you a link to access your account.</p>
      <input type="email"><button>Continue</button>`));
    expect(looksLikeNewsletter(el)).toBe(false);
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
