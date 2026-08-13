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

export async function applyContentSettings(settings) {
  const ok = [];
  const failed = [];

  for (const { key, types, blocked } of MAP) {
    const setting = settings[key] ? blocked : 'allow';
    for (const type of types) {
      try {
        await chrome.contentSettings[type].set({
          primaryPattern: '<all_urls>',
          setting,
        });
        ok.push(type);
      } catch (e) {
        // `sound` requires Chrome 141+; older builds reject it. Report, don't throw.
        failed.push({ key: type, error: e.message });
      }
    }
  }
  return { ok, failed };
}
