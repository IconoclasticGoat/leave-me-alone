import { getSettings } from '../settings.js';
import { applyContentSettings } from './content-settings.js';
import { applyRulesets } from './rulesets.js';

async function applyAll() {
  const settings = await getSettings();
  const [cs] = await Promise.all([
    applyContentSettings(settings),
    applyRulesets(settings),
  ]);
  // Surfaced by the popup so a toggle can never claim enforcement it didn't get.
  await chrome.storage.local.set({ lastApplyErrors: cs.failed });
}

chrome.runtime.onInstalled.addListener(applyAll);
chrome.runtime.onStartup.addListener(applyAll);
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'sync') applyAll();
});
