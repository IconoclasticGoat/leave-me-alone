import { CMP, UnsupportedAction } from './cmp.js';

// Every consent category is rejected. See the spec: "necessary" is never a
// category CMPs expose, so there is nothing to preserve.
const REJECT_ALL = { shouldAllow: () => false };

/**
 * @param {Set<string>} [opts.skip] Rules already run this page-load. A staged
 *   rule must not run twice: `onetrust` stays matchable after it has opened
 *   the panel, and running it again would click "Show Purposes" a second time
 *   and close what the next stage needs.
 */
export async function runEngine(bundle, root = document, { timeoutMs = 8000, skip } = {}) {
  const rules = bundle?.rules ?? {};

  for (const [name, config] of Object.entries(rules)) {
    if (skip?.has(name)) continue;

    const cmp = new CMP(name, config, REJECT_ALL);
    // A rule that cannot act must never shadow a later rule that can.
    if (!cmp.canAct()) continue;

    let detected = false;
    try {
      detected = cmp.isPresent(root) && cmp.isShowing(root);
    } catch {
      continue; // a malformed detector must not stop the sweep
    }
    if (!detected) continue;

    let outcome;
    try {
      outcome = await Promise.race([
        cmp.run(root),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), timeoutMs)),
      ]);
    } catch (e) {
      const reason = e instanceof UnsupportedAction ? 'unsupported-action' : 'error';
      return { handled: null, reason, cmp: name, error: e.message };
    }

    if (outcome.saved) return { handled: name, reason: 'ok' };
    // Opened a panel, or backed out of saving one we could not switch off.
    // Either way the CMP is still up and the caller must not hide it.
    if (outcome.acted) return { handled: null, reason: 'staged', cmp: name };
    // Matched but did nothing at all — let a later rule try.
  }

  return { handled: null, reason: 'no-cmp-detected' };
}
