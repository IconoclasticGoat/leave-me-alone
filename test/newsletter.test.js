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

  // Observed live on three ConvertKit/Kit recipe blogs. Every structural gate
  // already passed; only the word list failed, so these popups survived. Note
  // the field is type=text named email_address, not type=email.
  it('flags a ConvertKit recipe-blog popup that never says "newsletter"', () => {
    const el = mount(overlay(`<h2>Send me the recipes</h2>
      <input type="text" name="email_address" placeholder="Your Email">
      <input type="text" name="fields[first_name]" placeholder="Your Name">
      <button>SEND ME THE RECIPES</button>
      <p>I’d like to receive more tips &amp; recipes from The Test Kitchen.</p>`));
    expect(looksLikeNewsletter(el)).toBe(true);
  });

  // The two live sites disagree on the apostrophe, so the match must not
  // depend on it.
  it('flags the same consent line with a straight apostrophe', () => {
    const el = mount(overlay(`<h2>Get the recipes</h2>
      <input type="text" name="email_address" placeholder="Your Email">
      <button>GET THE RECIPES</button>
      <p>I'd like to receive more from Spend Some Pennies.</p>`));
    expect(looksLikeNewsletter(el)).toBe(true);
  });

  it('flags a free-ebook lead magnet', () => {
    const el = mount(overlay(`<h2>Download now</h2>
      <p>Grab my free ebook of weeknight dinners.</p>
      <input type="email" placeholder="Your Email"><button>Download</button>`));
    expect(looksLikeNewsletter(el)).toBe(true);
  });

  it('flags a free-guide lead magnet', () => {
    const el = mount(overlay(`<h2>My free guide to sourdough</h2>
      <input type="email" placeholder="Your Email"><button>Send it</button>`));
    expect(looksLikeNewsletter(el)).toBe(true);
  });

  it('flags a free-printable lead magnet', () => {
    const el = mount(overlay(`<h2>Get my free printable meal planner</h2>
      <input type="email" placeholder="Your Email"><button>Yes please</button>`));
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

  // Each of these carries a REAL SUBSCRIBE_WORDS match, so the only thing
  // stopping dismissal is the specific refusal named. Remove that refusal and
  // the test flips — which is what makes it a guard rather than a decoration.
  it('refuses a password field even when the copy is pure marketing', () => {
    const el = mount(overlay(`<h2>Subscribe and get 10% off</h2>
      <input type="email"><input type="password"><button>Go</button>`));
    expect(looksLikeNewsletter(el)).toBe(false);
  });

  it('refuses an existing-account link even under newsletter copy', () => {
    const el = mount(overlay(`<h2>Join our newsletter</h2>
      <input type="email"><button>Go</button><a>Already have an account?</a>`));
    expect(looksLikeNewsletter(el)).toBe(false);
  });

  // "Send me the ..." was proposed as a subscribe phrase and deliberately not
  // added: passwordless auth uses the same words. This overlay has an email
  // field, no password, and no other AUTH_MARKER, so the word list is the only
  // thing standing between it and a broken login.
  it('leaves a "send me the login link" auth overlay alone', () => {
    const el = mount(overlay(`<h2>Welcome back</h2>
      <p>Send me the link to continue.</p>
      <input type="email"><button>Continue</button>`));
    expect(looksLikeNewsletter(el)).toBe(false);
  });

  it('refuses a magic link even under newsletter copy', () => {
    const el = mount(overlay(`<h2>Subscribe for updates</h2>
      <p>We'll send you a magic link.</p><input type="email">`));
    expect(looksLikeNewsletter(el)).toBe(false);
  });

  it('refuses a registration wall that dangles a discount', () => {
    // The realistic e-commerce pattern: account creation sold with a coupon.
    const el = mount(overlay(`<h2>Create your free account</h2>
      <p>Get exclusive discount access.</p>
      <input type="email"><button>Continue</button>`));
    expect(looksLikeNewsletter(el)).toBe(false);
  });

  // These two isolate the two inclusion guards (hasEmail, and the final
  // SUBSCRIBE_WORDS check) rather than any veto. Every other check in
  // looksLikeNewsletter passes on these fixtures, so only the named guard
  // can be producing `false`. Mutation-verified: deleting
  // `if (!hasEmail) return false;` flips only the first test; replacing the
  // final `return SUBSCRIBE_WORDS.some(...)` with `return true` flips only
  // the second.
  it('isolates hasEmail: real subscribe copy, no email input at all', () => {
    const el = mount(overlay(`<h2>Join our newsletter</h2>
      <input type="text" placeholder="Name"><button>Subscribe</button>`));
    expect(looksLikeNewsletter(el)).toBe(false);
  });

  it('isolates the SUBSCRIBE_WORDS check: email input, no marketing word anywhere', () => {
    const el = mount(overlay(`<h2>Welcome</h2>
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
