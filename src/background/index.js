import { getSettings } from '../settings.js';
import { applyContentSettings } from './content-settings.js';
import { applyRulesets } from './rulesets.js';
import { stampAllTabs, stampTab } from './action.js';

async function applyAll() {
  const settings = await getSettings();
  const [cs] = await Promise.all([
    applyContentSettings(settings),
    // A ruleset failure must not stop the content-settings error report
    // below from being written — the popup depends on it.
    applyRulesets(settings).catch((e) => {
      console.error('applyRulesets failed', e);
    }),
    stampAllTabs(settings).catch((e) => {
      console.error('stampAllTabs failed', e);
    }),
  ]);
  // Surfaced by the popup so a toggle can never claim enforcement it didn't get.
  await chrome.storage.local.set({ lastApplyErrors: cs.failed });
}

chrome.runtime.onInstalled.addListener(applyAll);
chrome.runtime.onStartup.addListener(applyAll);
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'sync') applyAll();
});

// Per-tab icon state. tab.url is readable without the "tabs" permission
// because host_permissions covers <all_urls> — the popup already relies
// on this. A navigation wakes the service worker, so no state is lost
// when it has been suspended.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== 'loading') return;
  await stampTab(tabId, tab.url, await getSettings());
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab) await stampTab(tabId, tab.url, await getSettings());
});
