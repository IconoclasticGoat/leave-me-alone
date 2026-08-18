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

// A stored domain is interpolated straight into a chrome.contentSettings
// match pattern and into declarativeNetRequest's excludedRequestDomains, so
// it has to be a plain DNS name. `new URL()` will not do that for us: '*' is
// not a forbidden host code point, so "http://*.com/" parses cleanly to the
// hostname "*.com" — and a failed navigation still leaves that url on the
// tab. Stored, it would emit "http://*.com/*", exempting every .com site from
// every layer, while Chrome would reject "*.com" as an excluded domain and
// fail the whole updateDynamicRules call atomically, freezing the previous
// dynamic rules in place indefinitely. Bracketed IPv6 literals ("[::1]") are
// rejected for the same reason.
const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * True when `hostname` can safely be stored in `pausedSites`. The popup uses
 * this to hide the pause button for a host it cannot pause, the way it
 * already hides it for a url it cannot parse — so pauseSite's refusal below
 * is never something a user can trigger and then watch do nothing.
 */
export function isPausableHost(hostname) {
  return HOSTNAME_RE.test(stripWww(hostname));
}

/**
 * Stores a hostname as paused. Returns true when it was stored (or already
 * was), false when the hostname was rejected as unstorable — see
 * HOSTNAME_RE. A rejected hostname is not stored and no error is thrown;
 * callers that show UI should gate on isPausableHost() first.
 */
export async function pauseSite(hostname) {
  const d = stripWww(hostname);
  if (!HOSTNAME_RE.test(d)) return false;
  const { pausedSites = [] } = await chrome.storage.sync.get({ pausedSites: [] });
  if (!pausedSites.includes(d)) {
    await chrome.storage.sync.set({ pausedSites: [...pausedSites, d] });
  }
  return true;
}

export async function unpauseSite(hostname) {
  const { pausedSites = [] } = await chrome.storage.sync.get({ pausedSites: [] });
  const d = stripWww(hostname);
  await chrome.storage.sync.set({ pausedSites: pausedSites.filter((x) => x !== d) });
}
