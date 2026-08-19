import { matchesAll } from './matchers.js';
import { createAction, UnsupportedAction } from './actions.js';

const ORDER = ['OPEN_OPTIONS', 'DO_CONSENT', 'SAVE_CONSENT', 'HIDE_CMP'];

export class CMP {
  constructor(name, config, ctx) {
    this.name = name;
    this.config = config;
    this.ctx = ctx;
  }

  isPresent(root) {
    return (this.config.detectors ?? []).some((d) => matchesAll(d.presentMatcher, root));
  }

  isShowing(root) {
    return (this.config.detectors ?? []).some((d) => matchesAll(d.showingMatcher, root));
  }

  method(name) {
    return (this.config.methods ?? []).find((m) => m.name === name);
  }

  /**
   * True if any method we actually run carries an action.
   *
   * Some vendored rules (onetrust_banner, sourcepoint, trustarcbar and ten
   * others) declare the ordered methods as bare names and put the real work
   * in UTILITY — upstream's hook for re-opening a CMP on demand, which is
   * deliberately not part of an automatic run. Running such a rule does
   * nothing at all, so treating it as a match reports success over a banner
   * that is still on screen, and suppresses the cosmetic fallback that would
   * otherwise have hidden it.
   */
  canAct() {
    return ORDER.some((name) => Boolean(this.method(name)?.action));
  }

  /** Throws UnsupportedAction if any method needs an action we do not implement. */
  async run(root) {
    for (const name of ORDER) {
      const m = this.method(name);
      if (!m?.action) continue;
      await createAction(m.action, this.ctx).execute(root);
    }
  }
}

export { UnsupportedAction };
