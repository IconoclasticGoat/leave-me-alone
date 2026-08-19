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

  /**
   * Runs the ordered methods and reports how far it got.
   *
   * Upstream splits some CMPs across two rules: one detects the banner and
   * opens its options, a second detects the panel that opening produced and
   * does the real consent work (onetrust -> onetrust_pcpanel is the case that
   * matters most). A run that only opened options is therefore not a failure,
   * it is a handoff — so it must neither claim success nor hide the CMP,
   * because hiding it would bury the panel the second rule detects.
   *
   * Throws UnsupportedAction if any method needs an action we do not implement.
   */
  async run(root) {
    const outcome = { acted: false, saved: false, consentOk: true, hidden: false };

    const runMethod = async (name) => {
      const m = this.method(name);
      if (!m?.action) return null;
      const r = await createAction(m.action, this.ctx).execute(root);
      outcome.acted = outcome.acted || r.acted;
      return r;
    };

    await runMethod('OPEN_OPTIONS');

    const consent = await runMethod('DO_CONSENT');
    if (consent) outcome.consentOk = consent.consentOk;

    // Saving a panel whose categories are still switched on would confirm the
    // site's defaults instead of our rejection — worse than leaving it alone.
    if (!outcome.consentOk) return outcome;

    const save = await runMethod('SAVE_CONSENT');
    // A declared SAVE_CONSENT that found no target has not resolved anything;
    // the panel it saves has usually not rendered yet. Leave the CMP visible
    // and let the next sweep pick it up.
    if (save && !save.acted) return outcome;
    outcome.saved = save ? save.acted : true;

    const hide = await runMethod('HIDE_CMP');
    outcome.hidden = Boolean(hide?.acted);
    return outcome;
  }
}

export { UnsupportedAction };
