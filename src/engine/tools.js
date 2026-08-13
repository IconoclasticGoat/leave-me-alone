export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function isShown(el) {
  if (!el || !el.isConnected) return false;
  const style = el.ownerDocument.defaultView.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (style.opacity === '0') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function matchesText(el, filters) {
  if (!filters || filters.length === 0) return true;
  const text = (el.textContent ?? '').trim().toLowerCase();
  return filters.some((f) => text.includes(String(f).trim().toLowerCase()));
}

export function queryAll(root, target) {
  if (!target?.selector) return [];
  let els;
  try {
    els = Array.from((root ?? document).querySelectorAll(target.selector));
  } catch {
    return []; // malformed selector in a rule must never throw into the page
  }
  if (target.textFilter) els = els.filter((el) => matchesText(el, target.textFilter));
  if (target.displayFilter) els = els.filter((el) => isShown(el));
  if (target.childFilter) {
    els = els.filter((el) => queryAll(el, target.childFilter).length > 0);
  }
  return els;
}

export async function waitFor(fn, timeoutMs = 2000, intervalMs = 50) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() >= deadline) return null;
    await sleep(intervalMs);
  }
}
