export const RULESET_MAP = {
  gpc: 'gpc',
  googleOneTap: 'one-tap',
  chatWidgets: 'chat-widgets',
};

export async function applyRulesets(settings) {
  const enableRulesetIds = [];
  const disableRulesetIds = [];
  for (const [key, id] of Object.entries(RULESET_MAP)) {
    (settings[key] ? enableRulesetIds : disableRulesetIds).push(id);
  }
  await chrome.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds,
    disableRulesetIds,
  });
}
