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
