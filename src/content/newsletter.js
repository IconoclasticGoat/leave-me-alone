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
//
// Entries are regex source, matched from the start of a word (see AUTH_RE).
// 'signin' alone is closed at the end as well: open, it matches "signing",
// and "By signing up you agree…" is ordinary newsletter consent copy.
const AUTH_MARKERS = [
  'sign in', 'signin\\b', 'log in', 'login', 'already have an account',
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

// Anchored at the start only. As bare substrings the markers also fired
// inside other words — 'log in' on "our blog in your inbox" — and no auth
// phrase starts mid-word. The end stays open so "log into" and "registered"
// still count.
const AUTH_RE = new RegExp(`\\b(?:${AUTH_MARKERS.join('|')})`);

// Word boundaries need the text two ways. textContent runs neighbouring
// elements together — <button>Go</button><a>Already have an account?</a>
// reads "goalready have…" — so it hides the start of a word. Spacing every
// text node apart fixes that but splits a word styled in pieces
// (<span>S</span>ign in), which only textContent still reads whole.
function isAuthFlow(el, text) {
  if (AUTH_RE.test(text)) return true;
  const walker = el.ownerDocument.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
  const parts = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.data);
  return AUTH_RE.test(parts.join(' ').toLowerCase());
}

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
  if (isAuthFlow(el, text)) return false;

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

// Popups reported still showing with the toggle on, named by host. The
// heuristic stays conservative on purpose, so some real popups will always
// fall outside it. Hosts match the way pause does: the domain and any
// subdomain.
const KNOWN_POPUPS = [
  // "Subscribe to our newsletters!" The id is the one AdGuard's Annoyances
  // filter hides on this host.
  { host: 'wowhead.com', selector: '#newsletter-cta-wrapper' },
];

function knownPopups(root, host) {
  const h = String(host).toLowerCase();
  return KNOWN_POPUPS
    .filter((p) => h === p.host || h.endsWith(`.${p.host}`))
    .flatMap((p) => [...root.querySelectorAll(p.selector)])
    .filter(isShown);
}

export function findNewsletterModals(root = document, host = root.location?.hostname ?? '') {
  const candidates = root.querySelectorAll('div, section, aside, dialog');
  const found = new Set([...candidates].filter(looksLikeNewsletter));
  for (const el of knownPopups(root, host)) found.add(el);
  return [...found];
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
