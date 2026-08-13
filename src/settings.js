export const DEFAULTS = {
  // primary
  cookieBanners: true,
  notifications: true,
  location: true,
  newsletters: true,
  // more, on by default
  gpc: true,
  cameraMic: true,
  popupsDownloads: true,
  autoplaySound: true,
  // more, off by default
  chatWidgets: false,
  googleOneTap: false,
  sessionOnlyCookies: false,
};

const SHAPE = { ...DEFAULTS, pausedSites: [] };

export async function getSettings() {
  return chrome.storage.sync.get(SHAPE);
}

export async function setSetting(key, value) {
  await chrome.storage.sync.set({ [key]: value });
}

export function isPaused(settings, hostname) {
  const host = String(hostname).toLowerCase();
  return (settings.pausedSites ?? []).some(
    (d) => host === d || host.endsWith(`.${d}`)
  );
}

export async function pauseSite(hostname) {
  const { pausedSites = [] } = await chrome.storage.sync.get({ pausedSites: [] });
  const d = String(hostname).toLowerCase();
  if (!pausedSites.includes(d)) {
    await chrome.storage.sync.set({ pausedSites: [...pausedSites, d] });
  }
}

export async function unpauseSite(hostname) {
  const { pausedSites = [] } = await chrome.storage.sync.get({ pausedSites: [] });
  const d = String(hostname).toLowerCase();
  await chrome.storage.sync.set({ pausedSites: pausedSites.filter((x) => x !== d) });
}
