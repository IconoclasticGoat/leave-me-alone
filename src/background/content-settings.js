// Maps one settings key to one or more chrome.contentSettings types.
// `blocked` is the value applied when the toggle is ON.
const MAP = [
  { key: 'notifications',   types: ['notifications'],                  blocked: 'block' },
  { key: 'location',        types: ['location'],                       blocked: 'block' },
  { key: 'cameraMic',       types: ['camera', 'microphone'],           blocked: 'block' },
  { key: 'popupsDownloads', types: ['popups', 'automaticDownloads'],   blocked: 'block' },
  { key: 'autoplaySound',   types: ['sound'],                          blocked: 'block' },
  { key: 'sessionOnlyCookies', types: ['cookies'],                     blocked: 'session_only' },
];

// Chrome rejects 'ask' for these three — popups and sound take only
// allow/block, cookies takes allow/block/session_only. Everything else
// releases to 'ask' so the decision goes back to the user rather than
// being granted on their behalf.
const NO_ASK = new Set(['popups', 'sound', 'cookies']);

export function releaseValueFor(type) {
  return NO_ASK.has(type) ? 'allow' : 'ask';
}

// A paused site needs a pattern more specific than '<all_urls>' to win.
// Both schemes, and both the bare domain and its subdomains, matching how
// isPaused() treats a stored domain.
export function patternsFor(domain) {
  return [
    `http://${domain}/*`, `https://${domain}/*`,
    `http://*.${domain}/*`, `https://*.${domain}/*`,
  ];
}

export async function applyContentSettings(settings) {
  const ok = [];
  const failed = [];
  const paused = settings.pausedSites ?? [];

  for (const { key, types, blocked } of MAP) {
    const global = settings[key] ? blocked : null;
    for (const type of types) {
      try {
        // No API removes a single pattern, so every apply is a full
        // reconciliation: wipe what we wrote last time, then rewrite it.
        // Without this, unpausing would leave its exception behind forever.
        await chrome.contentSettings[type].clear({});
        await chrome.contentSettings[type].set({
          primaryPattern: '<all_urls>',
          setting: global ?? releaseValueFor(type),
        });
        for (const domain of paused) {
          for (const primaryPattern of patternsFor(domain)) {
            await chrome.contentSettings[type].set({
              primaryPattern,
              setting: releaseValueFor(type),
            });
          }
        }
        ok.push(type);
      } catch (e) {
        // `sound` requires Chrome 141+; older builds reject it. Report, don't throw.
        failed.push({ type, settingKey: key, error: e?.message ?? String(e) });
      }
    }
  }
  return { ok, failed };
}
