import { beforeEach, describe, it, expect } from 'vitest';
import { DEFAULTS, getSettings, setSetting, isPaused, pauseSite, unpauseSite } from '../src/settings.js';

let store;
beforeEach(() => {
  store = {};
  globalThis.chrome = {
    storage: { sync: {
      get: async (defaults) => ({ ...defaults, ...store }),
      set: async (obj) => { Object.assign(store, obj); },
    }},
  };
});

describe('settings', () => {
  it('defaults the four primary toggles on', async () => {
    const s = await getSettings();
    expect(s.cookieBanners).toBe(true);
    expect(s.notifications).toBe(true);
    expect(s.location).toBe(true);
    expect(s.newsletters).toBe(true);
  });

  it('defaults session-only cookies off', async () => {
    expect((await getSettings()).sessionOnlyCookies).toBe(false);
  });

  it('persists a changed toggle', async () => {
    await setSetting('notifications', false);
    expect((await getSettings()).notifications).toBe(false);
  });

  // Renamed from "matches paused sites on registrable domain, including
  // subdomains": that title overstates what this asserts. True eTLD+1
  // matching needs a public-suffix list, which this zero-dependency build
  // does not take on. What actually happens is simpler: a stored *bare*
  // domain also matches its subdomains via a suffix check. It does not
  // compute a registrable domain from an arbitrary hostname (see the
  // www.-stripping tests below for where that distinction bites).
  it('matches an exact stored domain and its subdomains', async () => {
    await pauseSite('example.com');
    const s = await getSettings();
    expect(isPaused(s, 'example.com')).toBe(true);
    expect(isPaused(s, 'shop.example.com')).toBe(true);
    expect(isPaused(s, 'notexample.com')).toBe(false);
  });

  it('unpauses a paused site', async () => {
    await pauseSite('example.com');
    await unpauseSite('example.com');
    const s = await getSettings();
    expect(isPaused(s, 'example.com')).toBe(false);
  });

  it('unpausing a site that was never paused is harmless', async () => {
    await unpauseSite('never-paused.com');
    const s = await getSettings();
    expect(isPaused(s, 'never-paused.com')).toBe(false);
    expect(s.pausedSites).toEqual([]);
  });

  it('strips a leading www. when pausing, so the bare domain and other subdomains also match', async () => {
    // popup.js pauses on tab.url's hostname verbatim, which for most sites
    // is "www.example.com". Without stripping, pausedSites would contain
    // "www.example.com" and isPaused would miss the bare domain and any
    // other subdomain — see Fix 4 in the review.
    await pauseSite('www.nytimes.com');
    const s = await getSettings();
    expect(isPaused(s, 'www.nytimes.com')).toBe(true);
    expect(isPaused(s, 'nytimes.com')).toBe(true);
    expect(isPaused(s, 'cooking.nytimes.com')).toBe(true);
  });

  it('unpauses a www.-prefixed host against the stripped, stored bare domain', async () => {
    // If pauseSite strips www. but unpauseSite does not, resuming from the
    // popup (which always passes the raw www.-prefixed hostname) would
    // silently fail to remove the stored bare domain, stranding the user
    // permanently paused.
    await pauseSite('www.nytimes.com');
    await unpauseSite('www.nytimes.com');
    const s = await getSettings();
    expect(isPaused(s, 'www.nytimes.com')).toBe(false);
    expect(s.pausedSites).toEqual([]);
  });
});
