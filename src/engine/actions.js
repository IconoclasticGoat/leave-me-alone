import { queryAll, sleep, waitFor } from './tools.js';
import { createMatcher } from './matchers.js';

export class UnsupportedAction extends Error {
  constructor(type) {
    super(`unsupported action: ${type}`);
    this.name = 'UnsupportedAction';
  }
}

const TYPES = {
  click: (c) => async (root) => {
    queryAll(root, c.target)[0]?.click();
  },

  multiclick: (c) => async (root) => {
    for (const el of queryAll(root, c.target)) el.click();
  },

  list: (c, ctx) => async (root) => {
    for (const child of c.actions ?? []) {
      await createAction(child, ctx).execute(root);
    }
  },

  wait: (c) => async () => { await sleep(c.waitTime ?? 250); },

  waitcss: (c) => async (root) => {
    await waitFor(
      () => {
        const hit = queryAll(root, { selector: c.target?.selector, displayFilter: c.target?.displayFilter }).length > 0;
        return c.negated ? !hit : hit;
      },
      c.timeout ?? 2000,
      c.retries ? Math.max(10, (c.timeout ?? 2000) / c.retries) : 50,
    );
  },

  hide: (c) => async (root) => {
    for (const el of queryAll(root, c.target)) {
      el.style.setProperty('display', 'none', 'important');
    }
  },

  close: () => async () => { globalThis.close?.(); },

  foreach: (c, ctx) => async (root) => {
    for (const el of queryAll(root, c.target)) {
      await createAction(c.action, ctx).execute(el);
    }
  },

  ifcss: (c, ctx) => async (root) => {
    const present = queryAll(root, c.target).length > 0;
    const branch = present ? c.trueAction : c.falseAction;
    if (branch) await createAction(branch, ctx).execute(root);
  },

  // We always reject every category, so `allow all` is never true
  // and `allow none` is always true. Both collapse to constants.
  ifallowall: (c, ctx) => async (root) => {
    if (c.falseAction) await createAction(c.falseAction, ctx).execute(root);
  },

  ifallownone: (c, ctx) => async (root) => {
    if (c.trueAction) await createAction(c.trueAction, ctx).execute(root);
  },

  consent: (c, ctx) => async (root) => {
    for (const consent of c.consents ?? []) {
      const allow = ctx.shouldAllow(consent.type);

      // Explicit true/false actions take precedence over toggling.
      const direct = allow ? consent.trueAction : consent.falseAction;
      if (direct) {
        await createAction(direct, ctx).execute(root);
        continue;
      }

      // Toggling requires a matcher — without one we cannot read current
      // state, and a blind click could switch a category ON. Skip instead.
      if (!consent.toggleAction || !consent.matcher) continue;

      const isOn = createMatcher(consent.matcher).matches(root);
      if (isOn !== allow) {
        await createAction(consent.toggleAction, ctx).execute(root);
      }
    }
  },
};

export function createAction(config, ctx) {
  const make = TYPES[config?.type];
  if (!make) {
    return { execute: async () => { throw new UnsupportedAction(config?.type); } };
  }
  const fn = make(config, ctx);
  return { execute: (root) => fn(root ?? document) };
}
