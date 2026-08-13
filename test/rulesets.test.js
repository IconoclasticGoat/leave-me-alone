import { readFileSync } from 'node:fs';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { applyRulesets } from '../src/background/rulesets.js';

let update;
beforeEach(() => {
  update = vi.fn(async () => {});
  globalThis.chrome = { declarativeNetRequest: { updateEnabledRulesets: update } };
});

describe('DNR rulesets', () => {
  it('gpc rule sets the Sec-GPC header on every request', () => {
    const r = JSON.parse(readFileSync('rules/gpc.json', 'utf8'))[0];
    expect(r.action.type).toBe('modifyHeaders');
    const h = r.action.requestHeaders[0];
    expect(h).toMatchObject({ header: 'Sec-GPC', operation: 'set', value: '1' });
    expect(r.condition.urlFilter).toBe('*');
  });

  it('enables and disables rulesets to match settings', async () => {
    await applyRulesets({ gpc: true, googleOneTap: false, chatWidgets: true });
    expect(update).toHaveBeenCalledWith({
      enableRulesetIds: ['gpc', 'chat-widgets'],
      disableRulesetIds: ['one-tap'],
    });
  });
});
