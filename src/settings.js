export const DEFAULTS = {
  // primary
  cookieBanners: true,
  notifications: true,
  location: true,
  newsletters: true,
  // more, on by default
  gpc: true,
  // more, off by default
  // cameraMic writes Chrome's `camera` and `microphone` block. Unlike
  // notifications or location, a blocked value doesn't merely suppress the
  // prompt — it denies access outright and overrides the user clicking Allow,
  // so it breaks every in-browser video call (Meet, Zoom web) until it is
  // switched off. Blocking a permission people actively use is not a default
  // worth shipping: it is opt-in. A site you do want it on for is covered by
  // switching the toggle on; a single site you want exempt is covered by Pause.
  cameraMic: false,
  // autoplaySound writes Chrome's `sound` content setting. Manual QA settled
  // what that actually does: it is a full mute, not autoplay suppression — a
  // blocked site stays silent even when the user presses play themselves. The
  // toggle is therefore labelled "Mute all sites" and carries a warning, and
  // it stays off by default: a silent YouTube out of the box is not a default
  // worth shipping. See Item 3b in docs/QA.md.
  autoplaySound: false,
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
// rejected for the same reason: the brackets and colons are not valid DNS
// label characters. Single-label hosts ("localhost", "router") are
// deliberately allowed — the dotted-suffix group is optional — since both
// patternsFor and excludedRequestDomains accept them without issue, and this
// is a developer-facing tool where "localhost" is the single most likely
// host someone wants to pause.
const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

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
