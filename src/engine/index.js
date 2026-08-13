import { CMP, UnsupportedAction } from './cmp.js';

// Every consent category is rejected. See the spec: "necessary" is never a
// category CMPs expose, so there is nothing to preserve.
const REJECT_ALL = { shouldAllow: () => false };

export async function runEngine(bundle, root = document, { timeoutMs = 8000 } = {}) {
  const rules = bundle?.rules ?? {};

  for (const [name, config] of Object.entries(rules)) {
    const cmp = new CMP(name, config, REJECT_ALL);

    let detected = false;
    try {
      detected = cmp.isPresent(root) && cmp.isShowing(root);
    } catch {
      continue; // a malformed detector must not stop the sweep
    }
    if (!detected) continue;

    try {
      await Promise.race([
        cmp.run(root),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), timeoutMs)),
      ]);
      return { handled: name, reason: 'ok' };
    } catch (e) {
      const reason = e instanceof UnsupportedAction ? 'unsupported-action' : 'error';
      return { handled: null, reason, cmp: name, error: e.message };
    }
  }

  return { handled: null, reason: 'no-cmp-detected' };
}
