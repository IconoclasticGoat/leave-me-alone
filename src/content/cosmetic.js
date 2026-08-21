import { isShown } from '../engine/tools.js';

// 'tracking' removed: it reads consent-adjacent but is common on ordinary
// furniture that has nothing to do with cookies ("Order tracking" panels,
// shipment status widgets). Nothing here requires it — real consent UIs
// still match on 'cookie'/'cookies'/'consent'/'gdpr'.
const COOKIE_WORDS = [
  'cookie', 'cookies', 'consent', 'gdpr', 'privacy preferences',
];
const ACCEPT_WORDS = ['accept', 'agree', 'allow', 'got it', 'ok', 'reject', 'decline'];

// Origins that serve consent UI inside an iframe. A CMP that does this splits
// the banner across a frame boundary and neither half looks like a banner:
// the host page keeps a bare fixed <div> with no prose and no buttons, and
// inside the frame the banner computes to `position: absolute` because the
// host's wrapper owns the fixed placement. An allowlist is the safe
// direction — "fixed wrapper around a cross-origin frame" also describes a
// Stripe checkout, a video lightbox and a paywall, and hiding one of those
// breaks the page in a way under-hiding never does.
const CMP_FRAME_HOSTS = [
  'cdn.privacy-mgmt.com',       // Sourcepoint
  'ccpa-notice.sp-prod.net',    // Sourcepoint, US notices
  'consent.cookiebot.com',      // Cookiebot
  'consentcdn.cookiebot.com',
  'cdn.cookielaw.org',          // OneTrust
  'privacyportal.onetrust.com',
  'sdk.privacy-center.org',     // Didomi
  'app.usercentrics.eu',        // Usercentrics
  'cmp.quantcast.com',          // Quantcast
  'consent.trustarc.com',       // TrustArc
  'consent-pref.trustarc.com',
  'cmp.osano.com',              // Osano
  'cdn.iubenda.com',            // Iubenda
];

function normalize(s) {
  return (s ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

// Whole-word match only. Substring matching let 'ok' fire on "Book",
// "Look", "Cookbook" etc — any control whose text merely contained the
// two letters, not the word.
function matchesAcceptWord(controlText) {
  const norm = normalize(controlText);
  return ACCEPT_WORDS.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(norm));
}

// Text of el with interactive-control descendants (links, buttons) stripped
// out. A genuine cookie bar mentions cookies in its own prose ("We use
// cookies..."); ordinary site furniture (a footer's "Cookie policy" link, a
// nav's "Privacy preferences" link) only mentions it inside a control's own
// label. Scoping the cookie-word scan to prose text (not control labels)
// keeps that furniture out of the match without weakening real banners.
function prose(el) {
  const clone = el.cloneNode(true);
  for (const n of clone.querySelectorAll('a, button, [role=button]')) n.remove();
  return (clone.textContent ?? '').toLowerCase();
}

function looksLikeBanner(el) {
  if (!isShown(el)) return false;
  const style = el.ownerDocument.defaultView.getComputedStyle(el);
  if (!['fixed', 'sticky'].includes(style.position)) return false;

  const text = (el.textContent ?? '').toLowerCase();
  if (text.length > 1200) return false; // whole-page wrapper, not a banner

  const mentionsCookies = COOKIE_WORDS.some((w) => prose(el).includes(w));
  // Only real buttons (or role=button) count as an accept control. A nav
  // bar's items and a footer's policy links are <a> tags, not buttons — a
  // page's ordinary navigation must never be treated as a consent action.
  const hasButton = [...el.querySelectorAll('button, [role=button]')].some((b) =>
    matchesAcceptWord(b.textContent)
  );
  return mentionsCookies && hasButton;
}

export function isCmpFrame(frame) {
  let host;
  try {
    host = new URL(frame.src, frame.ownerDocument.baseURI).hostname.toLowerCase();
  } catch {
    return false; // an unparseable src is not an origin we recognise
  }
  return CMP_FRAME_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

// The element to hide for a CMP frame is the fixed wrapper the CMP puts
// around it, not the frame: the wrapper is what covers the viewport and
// swallows every click, and it survives hiding the frame alone.
function overlayFor(frame) {
  if (!isCmpFrame(frame) || !isShown(frame)) return null;
  const doc = frame.ownerDocument;
  const view = doc.defaultView;
  for (let el = frame; el && el !== doc.body; el = el.parentElement) {
    const { position } = view.getComputedStyle(el);
    if (position !== 'fixed' && position !== 'sticky') continue;
    // Prose in the wrapper means the host page keeps real content there;
    // hiding it would take that content with it.
    if (prose(el).trim()) return null;
    return el;
  }
  return null;
}

export function hideCookieBanners(root = document) {
  const hidden = new Set();
  const hide = (el) => {
    el.style.setProperty('display', 'none', 'important');
    hidden.add(el);
  };

  for (const el of root.querySelectorAll('div, section, aside, dialog, footer, nav')) {
    if (looksLikeBanner(el)) hide(el);
  }
  // Second pass: banners the first cannot see at all, because their prose and
  // their buttons are behind a frame boundary.
  for (const frame of root.querySelectorAll('iframe[src]')) {
    const overlay = overlayFor(frame);
    if (overlay) hide(overlay);
  }
  return hidden.size;
}
