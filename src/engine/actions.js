import { queryAll, sleep, waitFor } from './tools.js';
import { createMatcher } from './matchers.js';

export class UnsupportedAction extends Error {
  constructor(type) {
    super(`unsupported action: ${type}`);
    this.name = 'UnsupportedAction';
  }
}

// Every action reports two things:
//   acted     - did it find a target and do something to it?
//   consentOk - are all consent toggles it touched now in the state we asked
//               for? True by default: an action with nothing to verify cannot
//               fail verification.
// `acted` is what tells a caller a CMP was actually resolved rather than
// merely matched, and `consentOk` is what stops us saving a preference panel
// whose categories we failed to switch off.
const did = (acted) => ({ acted: Boolean(acted), consentOk: true });

const merge = (results) => results.reduce(
  (a, r) => ({ acted: a.acted || r.acted, consentOk: a.consentOk && r.consentOk }),
  { acted: false, consentOk: true },
);

const TYPES = {
  click: (c) => async (root) => {
    const el = queryAll(root, c.target)[0];
    el?.click();
    return did(el);
  },

  multiclick: (c) => async (root) => {
    const els = queryAll(root, c.target);
    for (const el of els) el.click();
    return did(els.length);
  },

  list: (c, ctx) => async (root) => {
    const out = [];
    for (const child of c.actions ?? []) {
      out.push(await createAction(child, ctx).execute(root));
    }
    return merge(out);
  },

  wait: (c) => async () => { await sleep(c.waitTime ?? 250); return did(false); },

  waitcss: (c) => async (root) => {
    const hit = await waitFor(
      () => {
        const found = queryAll(root, { selector: c.target?.selector, displayFilter: c.target?.displayFilter }).length > 0;
        return c.negated ? !found : found;
      },
      c.timeout ?? 2000,
      c.retries ? Math.max(10, (c.timeout ?? 2000) / c.retries) : 50,
    );
    return did(hit);
  },

  hide: (c) => async (root) => {
    const els = queryAll(root, c.target);
    for (const el of els) el.style.setProperty('display', 'none', 'important');
    return did(els.length);
  },

  close: () => async () => { globalThis.close?.(); return did(true); },

  foreach: (c, ctx) => async (root) => {
    const out = [];
    for (const el of queryAll(root, c.target)) {
      out.push(await createAction(c.action, ctx).execute(el));
    }
    return merge(out);
  },

  ifcss: (c, ctx) => async (root) => {
    const present = queryAll(root, c.target).length > 0;
    const branch = present ? c.trueAction : c.falseAction;
    return branch ? createAction(branch, ctx).execute(root) : did(false);
  },

  // We always reject every category, so `allow all` is never true
  // and `allow none` is always true. Both collapse to constants.
  ifallowall: (c, ctx) => async (root) => (
    c.falseAction ? createAction(c.falseAction, ctx).execute(root) : did(false)
  ),

  ifallownone: (c, ctx) => async (root) => (
    c.trueAction ? createAction(c.trueAction, ctx).execute(root) : did(false)
  ),

  consent: (c, ctx) => async (root) => {
    const out = [];
    for (const consent of c.consents ?? []) {
      const allow = ctx.shouldAllow(consent.type);

      // Explicit true/false actions take precedence over toggling.
      const direct = allow ? consent.trueAction : consent.falseAction;
      if (direct) {
        out.push(await createAction(direct, ctx).execute(root));
        continue;
      }

      // Toggling requires a matcher — without one we cannot read current
      // state, and a blind click could switch a category ON. Skip instead.
      if (!consent.toggleAction || !consent.matcher) { out.push(did(false)); continue; }

      const matcher = createMatcher(consent.matcher);
      let acted = false;
      if (matcher.matches(root) !== allow) {
        acted = (await createAction(consent.toggleAction, ctx).execute(root)).acted;
      }

      // Re-read the switch. A toggle that silently refused to move — a
      // disabled input, a click the CMP swallowed — must not be reported as
      // consent handled, or we would go on to save a panel that is still
      // opted in.
      out.push({ acted, consentOk: matcher.matches(root) === allow });
    }
    return merge(out);
  },
};

export function createAction(config, ctx) {
  const make = TYPES[config?.type];
  if (!make) {
    return { execute: async () => { throw new UnsupportedAction(config?.type); } };
  }
  const fn = make(config, ctx);
  return { execute: async (root) => (await fn(root ?? document)) ?? did(false) };
}
