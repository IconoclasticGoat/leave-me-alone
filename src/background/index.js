import { getSettings } from '../settings.js';
import { applyContentSettings } from './content-settings.js';
import { applyRulesets } from './rulesets.js';
import { stampAllTabs, stampTab } from './action.js';

export async function applyAll() {
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

// chrome.storage.onChanged fires once per setSetting write, so flipping two
// toggles quickly starts two applyAll runs. Each is a long awaited sequence —
// clear, global set, then a set per paused pattern, across six
// content-setting types — and concurrent runs interleave, with the last
// writer winning per type. A stale run can therefore land its value after the
// fresh one, leaving a type enforcing the previous state, or leaving a
// paused-domain exception for a site that was just resumed, until the next
// settings change. Serialising costs nothing at this frequency.
let queue = Promise.resolve();
export function schedule() {
  queue = queue.then(applyAll).catch((e) => console.error('applyAll failed', e));
  return queue;
}

chrome.runtime.onInstalled.addListener(schedule);
chrome.runtime.onStartup.addListener(schedule);
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'sync') schedule();
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
