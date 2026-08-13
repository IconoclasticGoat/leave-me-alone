import { beforeEach, describe, it, expect } from 'vitest';
import { DEFAULTS, getSettings, setSetting, isPaused, pauseSite } from '../src/settings.js';

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

  it('matches paused sites on registrable domain, including subdomains', async () => {
    await pauseSite('example.com');
    const s = await getSettings();
    expect(isPaused(s, 'example.com')).toBe(true);
    expect(isPaused(s, 'shop.example.com')).toBe(true);
    expect(isPaused(s, 'notexample.com')).toBe(false);
  });
});
