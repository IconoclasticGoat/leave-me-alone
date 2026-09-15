import { isShown } from '../engine/tools.js';
import { prose } from './cosmetic.js';

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

// Origins that serve a newsletter signup form from inside an iframe. A widget
// that does this splits the popup across a frame boundary and neither half
// looks like a newsletter: from the host page the wrapper is a fixed box with
// zero inputs and no copy — every positive signal looksLikeNewsletter tests
// for is behind the boundary — and inside the frame the form is laid out
// normally, so isOverlay refuses it, because the host's wrapper rather than
// the form owns the fixed placement. This is the same split the cookie side
// hits with CMP frames; see CMP_FRAME_HOSTS in cosmetic.js.
//
// An allowlist is the safe direction for the reason given there: "fixed
// wrapper around a cross-origin frame" equally describes a Stripe checkout, a
// paywall and a video lightbox. The path is part of the match where the origin
// is a general-purpose one — a sender's app domain serves its own dashboard
// and, sooner or later, a hosted LOGIN widget, which is the one mistake this
// file exists to avoid. A dedicated embed origin carries no path.
const SIGNUP_FRAME_SOURCES = [
  { host: 'embeds.beehiiv.com' },            // beehiiv
  { host: 'substack.com', path: '/embed' },  // Substack
  { host: 'app.hive.co', path: '/signup/' }, // Hive
];

export function isSignupFrame(frame) {
  let url;
  try {
    url = new URL(frame.src, frame.ownerDocument.baseURI);
  } catch {
    return false; // an unparseable src is not an origin we recognise
  }
  const host = url.hostname.toLowerCase();
  return SIGNUP_FRAME_SOURCES.some(({ host: h, path }) =>
    (host === h || host.endsWith(`.${h}`))
    && (!path || url.pathname.startsWith(path)));
}

// The element to dismiss for a signup frame is the fixed wrapper the widget
// script puts around it, not the frame: the wrapper is what covers the
// viewport and swallows every click, it carries the close button, and it
// survives hiding the frame alone.
//
// Narrower than isOverlay on purpose — fixed/sticky only, no `absolute`.
// The same embed origins are used for ordinary INLINE signup blocks in a
// footer or between article sections, and an inline block sitting in some
// absolutely-positioned section would otherwise read as a popup. A modal
// wrapper is fixed in practice; requiring it is what keeps the page's own
// furniture out of reach.
function overlayForSignupFrame(frame) {
  if (!isSignupFrame(frame) || !isShown(frame)) return null;
  const doc = frame.ownerDocument;
  const view = doc.defaultView;
  for (let el = frame; el && el !== doc.body; el = el.parentElement) {
    const { position } = view.getComputedStyle(el);
    if (position !== 'fixed' && position !== 'sticky') continue;
    // Prose in the wrapper means the host page keeps real content there;
    // hiding it would take that content with it. Control labels are stripped
    // first, so the wrapper's own "Close" button does not read as content.
    if (prose(el).trim()) return null;
    return el;
  }
  return null;
}

export function findNewsletterModals(root = document) {
  const candidates = root.querySelectorAll('div, section, aside, dialog');
  const found = new Set([...candidates].filter(looksLikeNewsletter));
  // Second pass: signup widgets served from a cross-origin frame, whose form
  // and copy sit behind a boundary the pass above cannot read across.
  for (const frame of root.querySelectorAll('iframe[src]')) {
    const overlay = overlayForSignupFrame(frame);
    if (overlay) found.add(overlay);
  }
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
