// test/newsletter.test.js
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  looksLikeNewsletter, findNewsletterModals, dismissNewsletter, isSignupFrame,
} from '../src/content/newsletter.js';

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

  // Same dark pattern, phone field instead of email. Observed live as a
  // full-screen modal on desktop and mobile alike. The consent boilerplate is
  // legally mandated for US SMS marketing, which makes it a precise signal.
  it('flags an SMS signup modal carrying SMS-marketing consent copy', () => {
    const el = mount(overlay(`<h2>Signup for texts and get 10% off today</h2>
      <input type="tel" placeholder="Your Phone Number">
      <button>Get 10% Off</button>
      <p>By submitting this form you agree to receive recurring automated
      marketing text messages. Reply STOP to cancel. Msg &amp; data rates
      may apply.</p>`));
    expect(looksLikeNewsletter(el)).toBe(true);
  });

  it('flags an SMS signup whose phone field is named rather than type=tel', () => {
    const el = mount(overlay(`<h2>Text club</h2>
      <input type="text" name="phone_number" placeholder="Mobile number">
      <button>Join</button>
      <p>Msg frequency varies. Reply HELP for help.</p>`));
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

  // Accepting phone fields newly exposes us to OTP, checkout and address
  // overlays. Each of these must stay untouched.
  // Carries genuine SMS consent boilerplate — carriers' copy shows up on OTP
  // screens too — so the SMS_MARKERS check passes and the auth marker is the
  // only thing left refusing it.
  it('leaves a one-time-code overlay alone', () => {
    const el = mount(overlay(`<h2>Verify your number</h2>
      <p>Enter the security code we sent to •••1234.
      Msg &amp; data rates may apply.</p>
      <input type="tel" name="code"><button>Verify</button>`));
    expect(looksLikeNewsletter(el)).toBe(false);
  });

  it('leaves a checkout overlay with a phone field alone', () => {
    const el = mount(overlay(`<h2>Shipping address</h2>
      <input type="tel" name="phone"><input name="street"><input name="city">
      <button>Continue to payment</button>`));
    expect(looksLikeNewsletter(el)).toBe(false);
  });

  // Small enough to slip past the input-count limit, and it carries real SMS
  // consent copy — the opt-in checkbox at checkout. Only a commerce marker
  // stops this one.
  it('leaves a two-field checkout step carrying SMS opt-in copy alone', () => {
    const el = mount(overlay(`<h2>Delivery address</h2>
      <input type="tel" name="phone"><input name="zip">
      <p>Text me order updates. Msg &amp; data rates may apply.</p>
      <button>Continue to payment</button>`));
    expect(looksLikeNewsletter(el)).toBe(false);
  });

  it('refuses a phone field with no SMS-marketing copy', () => {
    // A bare phone field is never enough on its own — an SMS marker has to
    // carry it, or every contact form becomes a target.
    const el = mount(overlay(`<h2>Contact us</h2>
      <input type="tel" placeholder="Phone"><button>Send</button>`));
    expect(looksLikeNewsletter(el)).toBe(false);
  });

  it('refuses SMS-marketing copy with no phone or email field', () => {
    const el = mount(overlay(`<p>Msg &amp; data rates may apply. Reply STOP to
      cancel.</p><button>OK</button>`));
    expect(looksLikeNewsletter(el)).toBe(false);
  });

  it('leaves an inline SMS signup block alone (not an overlay)', () => {
    // Huckberry's footer carries consent copy identical to its modal's. The
    // overlay gate is the only thing telling them apart.
    document.body.innerHTML = `<div id="m" style="position:relative">
      <input type="tel" placeholder="Your Phone Number"><button>Sign up</button>
      <p>Recurring automated marketing text messages. Msg &amp; data rates may
      apply.</p></div>`;
    for (const el of document.querySelectorAll('*')) {
      el.getBoundingClientRect = () => ({ width: 400, height: 200 });
    }
    expect(looksLikeNewsletter(document.querySelector('#m'))).toBe(false);
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

// A signup widget served from a third-party origin puts the form, the copy and
// the email field inside an iframe, leaving the host page a bare fixed wrapper.
// looksLikeNewsletter cannot see any of it: no input crosses the boundary, no
// text crosses the boundary, and inside the frame the form is not an overlay
// because the wrapper owns the fixed placement. Each negative below isolates
// one guard — every other check passes on its fixture, so only the named guard
// can produce the empty result.
describe('findNewsletterModals — cross-origin signup frames', () => {
  const framed = (src, { position = 'fixed', prose = '' } = {}) =>
    `<div id="m" style="position:${position};z-index:9999">${prose}
      <button aria-label="Close">x</button>
      <iframe src="${src}"></iframe></div>`;

  it('finds the fixed wrapper around a hosted signup widget', () => {
    mount(framed('https://app.hive.co/signup/widget/1072/spotlight/'));
    expect(findNewsletterModals()).toEqual([document.querySelector('#m')]);
  });

  it('finds a wrapper around a dedicated embed origin, which needs no path', () => {
    mount(framed('https://embeds.beehiiv.com/1f3c9b2e-0000-4a5d-9c11-abcdef012345'));
    expect(findNewsletterModals()).toEqual([document.querySelector('#m')]);
  });

  it('matches an embed origin on a subdomain', () => {
    mount(framed('https://example.substack.com/embed'));
    expect(findNewsletterModals()).toEqual([document.querySelector('#m')]);
  });

  it('accepts a sticky wrapper as well as a fixed one', () => {
    mount(framed('https://embeds.beehiiv.com/abc', { position: 'sticky' }));
    expect(findNewsletterModals()).toEqual([document.querySelector('#m')]);
  });

  // Isolates the origin allowlist. Identical shape, and exactly the case the
  // allowlist exists to protect: hiding a payment sheet breaks the page in a
  // way missing a newsletter never does.
  it('leaves a fixed wrapper around an unrecognised frame alone', () => {
    mount(framed('https://js.stripe.com/v3/elements-inner-payment'));
    expect(findNewsletterModals()).toEqual([]);
  });

  // Isolates the path half of the match. Same allowlisted origin, but a
  // general-purpose one — its other widgets are not ours to dismiss.
  it('leaves another widget on the same sender origin alone', () => {
    mount(framed('https://app.hive.co/login/widget/1072/'));
    expect(findNewsletterModals()).toEqual([]);
  });

  // Isolates the fixed/sticky requirement, which is what tells a popup from the
  // same widget embedded inline in a footer or between article sections.
  it('leaves an inline embed of the same widget alone', () => {
    mount(framed('https://embeds.beehiiv.com/abc', { position: 'relative' }));
    expect(findNewsletterModals()).toEqual([]);
  });

  // Isolates the prose refusal. The wrapper is the host page's own content box,
  // so hiding it would take that content with it.
  it('leaves a fixed wrapper that holds host-page content alone', () => {
    mount(framed('https://embeds.beehiiv.com/abc', { prose: '<p>Latest episode</p>' }));
    expect(findNewsletterModals()).toEqual([]);
  });

  // Isolates isShown: the wrapper is still in the DOM between openings, and a
  // widget that has not fired yet must not be counted as dismissed.
  it('leaves a hidden wrapper alone', () => {
    document.body.innerHTML = framed('https://embeds.beehiiv.com/abc');
    expect(findNewsletterModals()).toEqual([]);
  });

  it('dismisses by clicking the wrapper close control, not by hiding', () => {
    const el = mount(framed('https://app.hive.co/signup/widget/1072/spotlight/'));
    let clicked = false;
    el.querySelector('[aria-label=Close]').addEventListener('click', () => { clicked = true; });
    expect(dismissNewsletter(el)).toBe('clicked-close');
    expect(clicked).toBe(true);
  });

  it('reports both a light-DOM popup and a framed one, without duplicates', () => {
    mount(`<div id="m" style="position:fixed;z-index:9999">
        <h2>Join our newsletter</h2><input type="email"><button>Subscribe</button>
      </div>
      <div id="f" style="position:fixed;z-index:9999">
        <iframe src="https://embeds.beehiiv.com/abc"></iframe>
      </div>`);
    expect(findNewsletterModals()).toEqual([
      document.querySelector('#m'), document.querySelector('#f'),
    ]);
  });
});

describe('isSignupFrame', () => {
  const frameWith = (src) => {
    document.body.innerHTML = `<iframe src="${src}"></iframe>`;
    return document.querySelector('iframe');
  };

  it('does not match a look-alike domain that merely ends with the name', () => {
    expect(isSignupFrame(frameWith('https://notsubstack.com/embed'))).toBe(false);
  });

  it('matches the real host and its subdomains', () => {
    expect(isSignupFrame(frameWith('https://a.b.substack.com/embed'))).toBe(true);
  });

  it('is not fooled by the widget path on an unrelated origin', () => {
    expect(isSignupFrame(frameWith('https://evil.example/signup/widget/1/'))).toBe(false);
  });
});
