import { isShown } from '../engine/tools.js';

const COOKIE_WORDS = [
  'cookie', 'cookies', 'consent', 'gdpr', 'privacy preferences', 'tracking',
];
const ACCEPT_WORDS = ['accept', 'agree', 'allow', 'got it', 'ok', 'reject', 'decline'];

function looksLikeBanner(el) {
  if (!isShown(el)) return false;
  const style = el.ownerDocument.defaultView.getComputedStyle(el);
  if (!['fixed', 'sticky'].includes(style.position)) return false;

  const text = (el.textContent ?? '').toLowerCase();
  if (text.length > 1200) return false; // whole-page wrapper, not a banner

  const mentionsCookies = COOKIE_WORDS.some((w) => text.includes(w));
  const hasButton = [...el.querySelectorAll('button, a, [role=button]')].some((b) =>
    ACCEPT_WORDS.some((w) => (b.textContent ?? '').toLowerCase().trim().includes(w))
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
