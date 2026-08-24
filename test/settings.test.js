import { beforeEach, describe, it, expect } from 'vitest';
import { DEFAULTS, getSettings, setSetting, isPaused, pauseSite, unpauseSite, isPausableHost } from '../src/settings.js';

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

  it('defaults camera & microphone off', async () => {
    // Unlike notifications or location, a blocked camera/microphone doesn't
    // just suppress the prompt — it denies access outright and overrides the
    // user clicking Allow, breaking every in-browser video call (Meet, Zoom
    // web) until it's switched off. Blocking a permission people actively use
    // is opt-in, not a shipped default.
    expect((await getSettings()).cameraMic).toBe(false);
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

  // A stored domain goes straight into a content-settings match pattern and
  // into declarativeNetRequest's excludedRequestDomains. new URL() does not
  // reject '*' in a host, and a failed navigation still populates tab.url,
  // so these reach pauseSite without an adversary.
  describe('pauseSite hostname validation', () => {
    const REJECTED = [
      ['*.com', 'a wildcard host would exempt every .com site'],
      ['a*b.com', 'any wildcard at all breaks the match pattern'],
      ['[::1]', 'a bracketed IPv6 literal is not a match-pattern host'],
      ['example.com.', 'a trailing dot yields an empty final label'],
      ['', 'nothing at all'],
      ['-bad.com', 'a label may not start with a hyphen'],
      ['exa mple.com', 'whitespace is not a host'],
    ];

    for (const [host, why] of REJECTED) {
      it(`refuses to store ${JSON.stringify(host)} — ${why}`, async () => {
        expect(await pauseSite(host)).toBe(false);
        const s = await getSettings();
        expect(s.pausedSites).toEqual([]);
      });
    }

    it('stores an ordinary hostname and reports that it did', async () => {
      expect(await pauseSite('www.example.co.uk')).toBe(true);
      expect((await getSettings()).pausedSites).toEqual(['example.co.uk']);
    });

    it('is idempotent for a host already paused', async () => {
      await pauseSite('example.com');
      expect(await pauseSite('example.com')).toBe(true);
      expect((await getSettings()).pausedSites).toEqual(['example.com']);
    });

    it('exposes the same verdict through isPausableHost, so the popup can hide the button', async () => {
      expect(isPausableHost('www.example.com')).toBe(true);
      expect(isPausableHost('shop.example.co.uk')).toBe(true);
      for (const [host] of REJECTED) expect(isPausableHost(host)).toBe(false);
    });

    // Single-label hosts have no dot and no registrable domain, but neither
    // downstream layer needs one: patternsFor yields valid content-setting
    // patterns and excludedRequestDomains accepts them. This is a
    // developer-facing tool, and localhost is the single most likely host
    // someone wants to pause while working.
    for (const host of ['localhost', 'router']) {
      it(`allows and stores the single-label host ${JSON.stringify(host)}`, async () => {
        expect(isPausableHost(host)).toBe(true);
        expect(await pauseSite(host)).toBe(true);
        expect((await getSettings()).pausedSites).toEqual([host]);
      });
    }
  });
});
