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
