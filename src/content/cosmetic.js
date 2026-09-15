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
//
// Exported because the newsletter pass needs the same question answered about
// a modal wrapper: does the host page keep real content in this box, or is it
// only a shell around someone else's frame?
export function prose(el) {
  const clone = el.cloneNode(true);
  for (const n of clone.querySelectorAll('a, button, [role=button]')) n.remove();
  return (clone.textContent ?? '').toLowerCase();
}

// An <a> is navigation, not a control — unless it goes nowhere. A consent
// "OK" that only sets a fragment dismisses the banner in place, while a policy
// link leaves the page; that is the line, not the tag. An anchor with no href
// counts only when it says it is a button: the cookieconsent library's
// "Got it!" is <a role="button" class="cc-btn cc-dismiss"> (neighborhoodscout.com),
// and role=button is the page telling assistive tech this is a control, not
// a link. A bare <a> with neither stays excluded: sites use those for layout
// as often as for controls, and no reported banner has needed them.
function isInPageControl(a) {
  const href = (a.getAttribute('href') ?? '').trim();
  if (!href) return a.getAttribute('role') === 'button';
  if (/^javascript:/i.test(href)) return true;
  try {
    const base = a.ownerDocument.baseURI;
    const to = new URL(href, base);
    const here = new URL(base);
    return to.origin === here.origin
      && to.pathname === here.pathname
      && to.search === here.search;
  } catch {
    return false; // an unparseable href is not something we act on
  }
}

function acceptControls(el) {
  return [...el.querySelectorAll('button, [role=button], a')]
    .filter((c) => c.tagName !== 'A' || isInPageControl(c));
}

function looksLikeBanner(el) {
  if (!isShown(el)) return false;
  const style = el.ownerDocument.defaultView.getComputedStyle(el);
  if (!['fixed', 'sticky'].includes(style.position)) return false;

  const text = (el.textContent ?? '').toLowerCase();
  if (text.length > 1200) return false; // whole-page wrapper, not a banner

  const mentionsCookies = COOKIE_WORDS.some((w) => prose(el).includes(w));
  // A nav bar's items and a footer's policy links must never read as a consent
  // action, which is what acceptControls() filters out — by where an anchor
  // goes rather than by its tag.
  const hasButton = acceptControls(el).some((b) => matchesAcceptWord(b.textContent));
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

// A consent iframe served from the page's OWN origin is one we can actually
// read into: the prose and the accept/reject controls live in the frame's own
// document, while the fixed placement sits on the frame element itself
// (rula.com's BigID widget renders an id="bigidcmp-banner-widget" iframe with
// an empty src, position: fixed — captured 2026-09-10). The light-DOM pass
// never queries into a frame document, and the cross-origin allowlist above
// never matches a same-origin src, so this shape slips past both. A
// cross-origin frame hands back a null contentDocument and is left to the
// allowlist pass; only a frame we can read is a candidate here. The test is the
// same conjunction looksLikeBanner applies — cookie prose AND an accept control
// on a shown, fixed/sticky box — with the prose and controls sourced from the
// frame's document and the position read from the frame element.
function isSameOriginBannerFrame(frame) {
  if (!isShown(frame)) return false;
  const { position } = frame.ownerDocument.defaultView.getComputedStyle(frame);
  if (position !== 'fixed' && position !== 'sticky') return false;
  let body;
  try {
    body = frame.contentDocument?.body;
  } catch {
    return false; // cross-origin: unreadable, not ours to act on here
  }
  if (!body) return false;
  if ((body.textContent ?? '').length > 1200) return false; // an app shell, not a banner
  const mentionsCookies = COOKIE_WORDS.some((w) => prose(body).includes(w));
  const hasButton = acceptControls(body).some((b) => matchesAcceptWord(b.textContent));
  return mentionsCookies && hasButton;
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

// querySelectorAll stops at every shadow boundary, so a banner rendered inside
// a shadow root is invisible to a plain query on the document — the host
// element is a bare wrapper with no prose and no buttons of its own. Consent
// widgets increasingly do exactly this (Osano's "consent opt-in" on
// commure.com renders the whole banner inside an OPEN shadow root), so gather
// the root plus every open shadow root beneath it and query each in turn.
// Closed roots expose no shadowRoot to script and are simply skipped — they are
// unreachable by design, not a case we can rescue.
function scopesUnder(root) {
  const scopes = [root];
  for (const el of root.querySelectorAll('*')) {
    if (el.shadowRoot) scopes.push(...scopesUnder(el.shadowRoot));
  }
  return scopes;
}

function deepQuery(root, selector) {
  return scopesUnder(root).flatMap((s) => [...s.querySelectorAll(selector)]);
}

export function hideCookieBanners(root = document) {
  const hidden = new Set();
  const hide = (el) => {
    el.style.setProperty('display', 'none', 'important');
    hidden.add(el);
  };

  for (const el of deepQuery(root, 'div, section, aside, dialog, footer, nav')) {
    if (looksLikeBanner(el)) hide(el);
  }
  // Second pass: cross-origin CMP frames, whose prose and buttons are behind a
  // frame boundary we cannot read — hide the fixed wrapper around them.
  for (const frame of deepQuery(root, 'iframe[src]')) {
    const overlay = overlayFor(frame);
    if (overlay) hide(overlay);
  }
  // Third pass: same-origin CMP frames, which we CAN read — confirm the banner
  // inside and hide the frame element, which is itself the fixed bar. Queried
  // without [src] because these frames often carry no src attribute at all.
  for (const frame of deepQuery(root, 'iframe')) {
    if (isSameOriginBannerFrame(frame)) hide(frame);
  }
  return hidden.size;
}
