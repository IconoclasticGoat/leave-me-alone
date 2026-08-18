import gpc from '../../rules/gpc.json';
import oneTap from '../../rules/one-tap.json';
import chatWidgets from '../../rules/chat-widgets.json';

// Static rulesets can only be toggled wholesale, which cannot express
// "everywhere except these domains". Dynamic rules can, so the JSON files
// are now rule *sources* rebuilt on every apply rather than shipped rulesets.
const SOURCES = [
  { key: 'gpc',          id: 1, rule: gpc[0] },
  { key: 'googleOneTap', id: 2, rule: oneTap[0] },
  { key: 'chatWidgets',  id: 3, rule: chatWidgets[0] },
];

export const RULE_IDS = SOURCES.map((s) => s.id);

export function buildDynamicRules(settings) {
  const paused = settings.pausedSites ?? [];
  return SOURCES.filter(({ key }) => settings[key]).map(({ id, rule }) => {
    const condition = { ...rule.condition };
    if (paused.length > 0) {
      // Both keys: requestDomains covers the paused main_frame itself
      // (which has no initiator), initiatorDomains covers what it loads.
      // Empty arrays are rejected by Chrome, hence the length guard.
      condition.excludedRequestDomains = paused;
      condition.excludedInitiatorDomains = paused;
    }
    return { ...rule, id, condition };
  });
}

export async function applyRulesets(settings) {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: RULE_IDS,
    addRules: buildDynamicRules(settings),
  });
}
