// CMPs and modals routinely lock scrolling and forget to unlock it once
// their element is gone. Always call this after a dismissal.
const LOCK_CLASSES = [
  'modal-open', 'no-scroll', 'noscroll', 'overflow-hidden',
  'cookie-consent-open', 'body-lock',
];

export function restoreScroll(doc = document) {
  for (const el of [doc.documentElement, doc.body]) {
    if (!el) continue;
    if (el.style.overflow === 'hidden') el.style.overflow = '';
    if (el.style.position === 'fixed') el.style.position = '';
    el.classList.remove(...LOCK_CLASSES);
  }
}
