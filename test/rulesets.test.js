import { readFileSync } from 'node:fs';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { applyRulesets, buildDynamicRules, RULE_IDS } from '../src/background/rulesets.js';

let update;
beforeEach(() => {
  update = vi.fn(async () => {});
  globalThis.chrome = { declarativeNetRequest: { updateDynamicRules: update } };
});

describe('rule sources', () => {
  it('gpc rule sets the Sec-GPC header on every request', () => {
    const r = JSON.parse(readFileSync('rules/gpc.json', 'utf8'))[0];
    expect(r.action.type).toBe('modifyHeaders');
    const h = r.action.requestHeaders[0];
    expect(h).toMatchObject({ header: 'Sec-GPC', operation: 'set', value: '1' });
    expect(r.condition.urlFilter).toBe('*');
  });
});

// Minimal model of Chrome's `||domain/path` urlFilter (literal, no wildcards):
// anchors at the domain boundary — the domain itself or any subdomain — then
// requires the URL, from immediately after the host, to start with the rest of
// the pattern. Enough to prove which Google Identity Services endpoints a rule
// does and does not block.
function blocks(filter, url) {
  const m = filter.match(/^\|\|([^/*^]+)(.*)$/);
  if (!m) throw new Error(`test helper only models ||domain filters, got: ${filter}`);
  const [, domain, rest] = m;
  const u = new URL(url);
  const hostOk = u.hostname === domain || u.hostname.endsWith(`.${domain}`);
  return hostOk && (u.pathname + u.search).startsWith(rest);
}

describe('google one-tap rule', () => {
  const ruleOf = () =>
    buildDynamicRules({ googleOneTap: true }).find((r) => r.id === 2);

  // The pre-FedCM One Tap prompt is an iframe gsi/client loads from
  // prompt_url = accounts.google.com/gsi/iframe/select. Blocking that sub_frame
  // removes the prompt card without touching anything else Google serves.
  //
  // Current Chrome never requests it — the prompt comes through FedCM, which
  // no rule can see, and is stopped in the page instead (test/one-tap.test.js).
  // This rule is what still covers a browser or a gsi/client configuration on
  // the iframe path, so it stays, and stays narrow.
  it('blocks the legacy One Tap prompt iframe', () => {
    const { condition } = ruleOf();
    expect(blocks(condition.urlFilter, 'https://accounts.google.com/gsi/iframe/select?client_id=x')).toBe(true);
    expect(condition.resourceTypes).toEqual(['sub_frame']);
  });

  // Regression: the filter used to be ||accounts.google.com/gsi/, which also
  // blocked the gsi/client library (a script) and the gsi/button iframe. That
  // broke the user-initiated "Sign in with Google" button — including on
  // claude.ai — not just the auto-prompt the toggle names. Blocking the
  // library is also the only reason the broad rule appeared to stop One Tap
  // at all, so this must not be widened back to buy the block returned: the
  // block lives in src/content/one-tap-guard.js now.
  it('leaves the Sign in with Google library, button, and styles working', () => {
    const { urlFilter } = ruleOf().condition;
    expect(blocks(urlFilter, 'https://accounts.google.com/gsi/client')).toBe(false);
    expect(blocks(urlFilter, 'https://accounts.google.com/gsi/button?client_id=x')).toBe(false);
    expect(blocks(urlFilter, 'https://accounts.google.com/gsi/style')).toBe(false);
  });
});

describe('buildDynamicRules', () => {
  it('includes only the rules whose toggles are on', () => {
    const rules = buildDynamicRules({ gpc: true, googleOneTap: false, chatWidgets: true });
    expect(rules.map((r) => r.id)).toEqual([1, 3]);
  });

  it('returns nothing when every toggle is off', () => {
    expect(buildDynamicRules({})).toEqual([]);
  });

  it('gives each rule a stable id so removeRuleIds can always clear them', () => {
    const a = buildDynamicRules({ gpc: true, googleOneTap: true, chatWidgets: true });
    const b = buildDynamicRules({ gpc: true, googleOneTap: true, chatWidgets: true });
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id));
    expect(RULE_IDS).toEqual([1, 2, 3]);
  });

  it('excludes paused domains as both request and initiator', () => {
    // main_frame requests have no initiator, so requestDomains is what
    // exempts the paused page itself; initiatorDomains exempts the
    // subresources that page goes on to load.
    const [rule] = buildDynamicRules({ gpc: true, pausedSites: ['example.com'] });
    expect(rule.condition.excludedRequestDomains).toEqual(['example.com']);
    expect(rule.condition.excludedInitiatorDomains).toEqual(['example.com']);
  });

  it('omits the exclusion keys entirely when nothing is paused', () => {
    // declarativeNetRequest rejects empty arrays for these fields.
    const [rule] = buildDynamicRules({ gpc: true, pausedSites: [] });
    expect('excludedRequestDomains' in rule.condition).toBe(false);
    expect('excludedInitiatorDomains' in rule.condition).toBe(false);
  });

  it('preserves the original condition alongside the exclusions', () => {
    const [rule] = buildDynamicRules({ chatWidgets: true, pausedSites: ['example.com'] });
    expect(rule.condition.requestDomains).toContain('widget.intercom.io');
    expect(rule.condition.excludedInitiatorDomains).toEqual(['example.com']);
  });

  it('does not mutate the imported rule source between calls', () => {
    buildDynamicRules({ gpc: true, pausedSites: ['example.com'] });
    const [rule] = buildDynamicRules({ gpc: true, pausedSites: [] });
    expect('excludedRequestDomains' in rule.condition).toBe(false);
  });
});

describe('applyRulesets', () => {
  it('clears every id and adds the current set in one call', async () => {
    await applyRulesets({ gpc: true, googleOneTap: false, chatWidgets: false });
    const [arg] = update.mock.calls[0];
    // Always remove all three ids, even the ones we are not re-adding —
    // that is what turns a toggle off.
    expect(arg.removeRuleIds).toEqual([1, 2, 3]);
    expect(arg.addRules).toHaveLength(1);
    expect(arg.addRules[0].id).toBe(1);
    expect(arg.addRules[0].action.type).toBe('modifyHeaders');
  });
});
