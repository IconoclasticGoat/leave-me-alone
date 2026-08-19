import { isShown } from '../engine/tools.js';

// Deliberately excludes "sign up" / "signup". Those are the one phrase a
// newsletter popup and an account-creation overlay genuinely share, so they
// cannot distinguish the two. Real newsletter popups almost always also say
// "newsletter", "subscribe", "% off", "discount", or "mailing list"; an
// overlay whose ONLY marketing signal is "sign up" is indistinguishable from
// a registration form, and we leave those alone.
// "like to receive" is ConvertKit/Kit's default consent line. Whole families of
// recipe blogs run its popups and never say "newsletter" or "subscribe" — the
// copy is "Send me the recipes" — so the structural checks passed and the word
// list was the only reason they survived. Matched without the leading "I'd":
// sites disagree on straight vs curly apostrophe.
//
// The lead-magnet phrases are the other half of that pattern: a free download
// in exchange for an address. "Send me the ..." was considered and rejected —
// passwordless auth says the same thing ("send me the login link").
const SUBSCRIBE_WORDS = [
  'newsletter', 'subscribe', 'join our', 'mailing list',
  '% off', 'discount', 'first order', 'stay in the loop', 'get updates',
  'like to receive', 'free ebook', 'free guide', 'free printable',
];

const CLOSE_SELECTORS = [
  '[aria-label*="close" i]', '[title*="close" i]', 'button.close', '.modal-close',
  '[class*="close" i][role="button"]', 'button[data-dismiss]',
];

// Overlays that are really account or auth flows. Any of these outweighs
// every positive signal. A passwordless "magic link" sign-in has an email
// input, overlay positioning, and "Sign up" copy — all three signals — yet
// dismissing it breaks the site's login. Missing a newsletter is cheap;
// destroying an auth flow is not.
const AUTH_MARKERS = [
  'sign in', 'signin', 'log in', 'login', 'already have an account',
  'continue with google', 'continue with apple', 'continue with facebook',
  'magic link', 'verification code', 'one-time code',
  'forgot password', 'reset password',
  // Registration walls. "Create your free account — get exclusive discount
  // access" carries a real marketing word and would otherwise be dismissed,
  // which is the expensive kind of mistake.
  'create account', 'create an account', 'create your account',
  'free account', 'your account', 'register',
  // Accepting phone fields (see SMS_MARKERS) puts one-time-code and checkout
  // overlays within reach of the positive path, so they need naming here.
  // A checkout step can be small enough to clear the input-count limit and
  // still carry real SMS consent copy in its opt-in checkbox.
  'security code', 'confirm your number', 'verify your number',
  'shipping', 'billing', 'delivery address', 'card number',
  'checkout', 'continue to payment',
];

// US SMS marketing consent copy is legally mandated boilerplate, which makes it
// a far more precise signal than the phone field itself. A phone field alone is
// never enough: contact forms, checkout and OTP flows all have one. Requiring
// one of these is what lets the phone branch exist safely.
const SMS_MARKERS = [
  'msg & data rates', 'msg frequency', 'message frequency',
  'reply stop', 'reply help', 'text stop',
  'recurring automated', 'marketing text messages',
];

function isOverlay(el) {
  const style = el.ownerDocument.defaultView.getComputedStyle(el);
  if (!['fixed', 'absolute', 'sticky'].includes(style.position)) return false;
  const z = parseInt(style.zIndex, 10);
  return Number.isNaN(z) ? true : z >= 100;
}

export function looksLikeNewsletter(el) {
  if (!el || !isShown(el)) return false;
  if (!isOverlay(el)) return false;

  // Hard refusals — these are the shapes we must never touch.
  if (el.querySelector('input[type=password]')) return false;
  if (el.querySelector('input[autocomplete="username"]')) return false;
  const inputs = el.querySelectorAll('input:not([type=hidden]):not([type=submit])');
  if (inputs.length > 2) return false;

  const text = (el.textContent ?? '').toLowerCase();
  if (AUTH_MARKERS.some((w) => text.includes(w))) return false;

  const hasEmail = Boolean(
    el.querySelector('input[type=email], input[name*="email" i], input[placeholder*="email" i]')
  );
  if (hasEmail) return SUBSCRIBE_WORDS.some((w) => text.includes(w));

  // An SMS signup is the same interruption wearing a phone field. It gets a
  // stricter test than the email path: marketing words like "10% off" are not
  // enough, because they also appear on checkout and order-status overlays.
  // Only the consent boilerplate qualifies.
  const hasPhone = Boolean(
    el.querySelector('input[type=tel], input[name*="phone" i], input[placeholder*="phone" i]')
  );
  if (hasPhone) return SMS_MARKERS.some((w) => text.includes(w));

  return false;
}

export function findNewsletterModals(root = document) {
  const candidates = root.querySelectorAll('div, section, aside, dialog');
  return [...candidates].filter(looksLikeNewsletter);
}

export function dismissNewsletter(el) {
  for (const sel of CLOSE_SELECTORS) {
    const btn = el.querySelector(sel);
    if (btn && isShown(btn)) {
      btn.click();
      return 'clicked-close';
    }
  }
  el.style.setProperty('display', 'none', 'important');
  return 'hidden';
}
