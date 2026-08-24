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

// Only used for the paused-domain exception, where a value *must* be written:
// a paused site needs a pattern that outranks our own '<all_urls>' block, and
// there is no way to write "nothing" at a narrower pattern. A toggle that is
// simply off writes nothing at all — see applyContentSettings.
export function releaseValueFor(type) {
  return NO_ASK.has(type) ? 'allow' : 'ask';
}

// Chrome's match-pattern parser rejects a wildcard subdomain on an address
// literal: '*.192.168.1.1' is not a host it will accept. An address has no
// subdomains to cover anyway, so the two exact-host patterns are the whole
// set. HOSTNAME_RE keeps IPv4 hosts pausable on purpose — a dev server on a
// LAN address is exactly what someone wants to pause — and without this the
// two wildcard patterns were rejected for every one of the eight
// content-setting types on every apply. Bracketed IPv6 literals never reach
// here; HOSTNAME_RE rejects them outright.
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

// A paused site needs a pattern more specific than '<all_urls>' to win.
// Both schemes, and — for a DNS name — both the bare domain and its
// subdomains, matching how isPaused() treats a stored domain.
export function patternsFor(domain) {
  const exact = [`http://${domain}/*`, `https://${domain}/*`];
  if (IPV4_RE.test(domain)) return exact;
  return [...exact, `http://*.${domain}/*`, `https://*.${domain}/*`];
}

const messageOf = (e) => e?.message ?? String(e);

export async function applyContentSettings(settings) {
  const ok = [];
  const failed = [];
  const paused = settings.pausedSites ?? [];
  // Only the cameraMic types honour this, and only while the block is written
  // below — see the per-site loop. It is a sibling of `paused`, not a reuse:
  // pausing frees every layer on a site; this frees camera/mic and nothing else.
  const camAllow = settings.cameraMicAllowlist ?? [];

  for (const { key, types, blocked } of MAP) {
    const global = settings[key] ? blocked : null;
    for (const type of types) {
      try {
        // No API removes a single pattern, so every apply is a full
        // reconciliation: wipe what we wrote last time, then rewrite it.
        // Without this, unpausing would leave its exception behind forever.
        await chrome.contentSettings[type].clear({});

        // Toggle off: write nothing. Extension-set content settings outrank
        // the user's own layer, so writing a release value here would push
        // *our* preference over theirs — and for cookies and popups that
        // release value is 'allow', which would leave the browser weaker
        // than if this extension had never been installed. clear() alone
        // hands the type back to the user's own settings.
        if (global === null) {
          ok.push(type);
          continue;
        }

        await chrome.contentSettings[type].set({
          primaryPattern: '<all_urls>',
          setting: global,
        });

        // Each paused domain gets its own try/catch: one pattern Chrome
        // rejects (an IP literal, a trailing-dot host) must not silently
        // drop the exemptions for every domain after it, because the global
        // block above is already in force and the toolbar icon is already
        // claiming the site is paused.
        let partial = false;
        for (const domain of paused) {
          for (const primaryPattern of patternsFor(domain)) {
            try {
              await chrome.contentSettings[type].set({
                primaryPattern,
                setting: releaseValueFor(type),
              });
            } catch (e) {
              partial = true;
              failed.push({
                type,
                settingKey: key,
                error: `${messageOf(e)} (pattern ${primaryPattern})`,
              });
            }
          }
        }

        // Per-site camera/mic allow. Written after the paused loop on purpose:
        // a site that is both paused and allowlisted resolves to 'allow' (the
        // later write wins at the same pattern), which is the stronger, more
        // specific intent. Only the cameraMic types carry an allowlist, so this
        // is a no-op for every other content-setting type.
        if (key === 'cameraMic') {
          for (const domain of camAllow) {
            for (const primaryPattern of patternsFor(domain)) {
              try {
                await chrome.contentSettings[type].set({
                  primaryPattern,
                  setting: 'allow',
                });
              } catch (e) {
                partial = true;
                failed.push({
                  type,
                  settingKey: key,
                  error: `${messageOf(e)} (pattern ${primaryPattern})`,
                });
              }
            }
          }
        }
        if (!partial) ok.push(type);
      } catch (e) {
        // `sound` requires Chrome 141+; older builds reject it. Report, don't throw.
        failed.push({ type, settingKey: key, error: messageOf(e) });
      }
    }
  }
  return { ok, failed };
}
