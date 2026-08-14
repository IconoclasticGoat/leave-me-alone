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

// Strips a leading "www." so pause/unpause key off the bare host. True
// eTLD+1 (registrable domain) resolution needs a public-suffix list, which
// this zero-dependency build does not take on — this is a narrow, common-case
// stand-in for it. Without it, pausing on tab.url's raw hostname (almost
// always "www.example.com") would store "www.example.com" verbatim, and the
// bare domain and any other subdomain would never match it (see isPaused's
// suffix check below, which only matches subdomains of the *stored* value).
function stripWww(hostname) {
  const host = String(hostname).toLowerCase();
  return host.startsWith('www.') ? host.slice(4) : host;
}

export function isPaused(settings, hostname) {
  const host = String(hostname).toLowerCase();
  return (settings.pausedSites ?? []).some(
    (d) => host === d || host.endsWith(`.${d}`)
  );
}

export async function pauseSite(hostname) {
  const { pausedSites = [] } = await chrome.storage.sync.get({ pausedSites: [] });
  const d = stripWww(hostname);
  if (!pausedSites.includes(d)) {
    await chrome.storage.sync.set({ pausedSites: [...pausedSites, d] });
  }
}

export async function unpauseSite(hostname) {
  const { pausedSites = [] } = await chrome.storage.sync.get({ pausedSites: [] });
  const d = stripWww(hostname);
  await chrome.storage.sync.set({ pausedSites: pausedSites.filter((x) => x !== d) });
}
