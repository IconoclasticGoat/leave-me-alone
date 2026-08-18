import { isShown } from '../engine/tools.js';

// 'tracking' removed: it reads consent-adjacent but is common on ordinary
// furniture that has nothing to do with cookies ("Order tracking" panels,
// shipment status widgets). Nothing here requires it — real consent UIs
// still match on 'cookie'/'cookies'/'consent'/'gdpr'.
const COOKIE_WORDS = [
  'cookie', 'cookies', 'consent', 'gdpr', 'privacy preferences',
];
const ACCEPT_WORDS = ['accept', 'agree', 'allow', 'got it', 'ok', 'reject', 'decline'];

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

export function hideCookieBanners(root = document) {
  let n = 0;
  for (const el of root.querySelectorAll('div, section, aside, dialog, footer, nav')) {
    if (looksLikeBanner(el)) {
      el.style.setProperty('display', 'none', 'important');
      n += 1;
    }
  }
  return n;
}
