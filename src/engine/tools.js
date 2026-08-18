export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function isShown(el) {
  if (!el || !el.isConnected) return false;
  // isConnected stays true for nodes inside a DETACHED iframe's document,
  // but that document's defaultView is null once its browsing context is
  // discarded. Consent UIs live in iframes constantly, so reading
  // ownerDocument.defaultView unguarded throws on a routine case.
  const view = el.ownerDocument?.defaultView;
  if (!view) return false;

  const style = view.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (style.opacity === '0') return false; // computed opacity normalizes to a string
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function matchesText(el, filters) {
  // Vendored rules occasionally carry a bare string where an array belongs.
  const list = Array.isArray(filters) ? filters : filters == null ? [] : [filters];
  if (list.length === 0) return true;
  const text = (el.textContent ?? '').trim().toLowerCase();
  return list.some((f) => text.includes(String(f).trim().toLowerCase()));
}

export function queryAll(root, target) {
  if (!target?.selector) return [];
  try {
    let els = Array.from((root ?? document).querySelectorAll(target.selector));
    if (target.textFilter) els = els.filter((el) => matchesText(el, target.textFilter));
    if (target.displayFilter) els = els.filter((el) => isShown(el));
    if (target.childFilter) {
      els = els.filter((el) => queryAll(el, target.childFilter).length > 0);
    }
    return els;
  } catch {
    // The guard covers the WHOLE pipeline, not just the selector: a detached
    // document, odd rule data, or a hostile getter must never throw into the
    // host page. Returning [] degrades to "found nothing".
    return [];
  }
}

export async function waitFor(fn, timeoutMs = 2000, intervalMs = 50) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let v = null;
    try {
      v = fn();
    } catch {
      v = null; // a throwing predicate is "not ready", never an escaping rejection
    }
    if (v) return v;
    if (Date.now() >= deadline) return null;
    await sleep(intervalMs);
  }
}
