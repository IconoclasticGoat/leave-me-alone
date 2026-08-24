import { beforeEach, describe, it, expect, vi } from 'vitest';
import { applyContentSettings, releaseValueFor, patternsFor } from '../src/background/content-settings.js';
import { DEFAULTS } from '../src/settings.js';

let calls, cleared;
const stub = (name) => ({
  set: vi.fn(async (arg) => { calls.push([name, arg.setting, arg.primaryPattern]); }),
  clear: vi.fn(async () => { cleared.push(name); }),
});

beforeEach(() => {
  calls = [];
  cleared = [];
  globalThis.chrome = { contentSettings: {
    notifications: stub('notifications'), location: stub('location'),
    camera: stub('camera'), microphone: stub('microphone'),
    popups: stub('popups'), automaticDownloads: stub('automaticDownloads'),
    sound: stub('sound'), cookies: stub('cookies'),
  }};
});

describe('releaseValueFor', () => {
  it('releases prompt-capable types to ask', () => {
    expect(releaseValueFor('notifications')).toBe('ask');
    expect(releaseValueFor('location')).toBe('ask');
    expect(releaseValueFor('camera')).toBe('ask');
    expect(releaseValueFor('automaticDownloads')).toBe('ask');
  });

  it('releases the three types Chrome refuses ask for to allow', () => {
    // popups, sound and cookies accept only allow/block (cookies also
    // session_only). Sending 'ask' would throw and land in lastApplyErrors.
    expect(releaseValueFor('popups')).toBe('allow');
    expect(releaseValueFor('sound')).toBe('allow');
    expect(releaseValueFor('cookies')).toBe('allow');
  });
});

describe('patternsFor', () => {
  it('covers both schemes, bare domain and subdomains', () => {
    expect(patternsFor('example.com')).toEqual([
      'http://example.com/*', 'https://example.com/*',
      'http://*.example.com/*', 'https://*.example.com/*',
    ]);
  });

  it('omits the wildcard-subdomain patterns for an IPv4 literal', () => {
    // Chrome's match-pattern parser rejects '*.192.168.1.1' — a wildcard
    // subdomain is only meaningful on a DNS name, and an IP literal has no
    // subdomains to cover. HOSTNAME_RE lets IPv4 hosts be paused on purpose,
    // so emitting them cost two rejected patterns per content-setting type
    // on every single apply.
    expect(patternsFor('192.168.1.1')).toEqual([
      'http://192.168.1.1/*', 'https://192.168.1.1/*',
    ]);
  });

  it('still covers subdomains of a DNS name whose first label is numeric', () => {
    // '3m.com' and '1.1.1.1' both start with a digit; only the second is an
    // address. A too-eager IP test would quietly drop subdomain coverage
    // from ordinary sites.
    expect(patternsFor('3m.com')).toEqual([
      'http://3m.com/*', 'https://3m.com/*',
      'http://*.3m.com/*', 'https://*.3m.com/*',
    ]);
  });
});

describe('applyContentSettings', () => {
  it('blocks notifications and location when their toggles are on', async () => {
    await applyContentSettings({ notifications: true, location: true });
    expect(calls).toContainEqual(['notifications', 'block', '<all_urls>']);
    expect(calls).toContainEqual(['location', 'block', '<all_urls>']);
  });

  it('clears a type whose toggle is off and then writes nothing at all', async () => {
    // Extension-set content settings outrank the user's own layer, so any
    // value written here — 'ask' included — pushes our preference over
    // theirs. clear() alone returns the type to the user's own settings,
    // which is the only honest thing an off toggle can do.
    await applyContentSettings({ notifications: false });
    expect(cleared).toContain('notifications');
    expect(calls.filter(([type]) => type === 'notifications')).toEqual([]);
  });

  it('never force-allows cookies with the stock default of sessionOnlyCookies off', async () => {
    // The default install path. Writing 'allow' at <all_urls> here would
    // hand every site a blanket cookie grant that beats the user's own
    // cookie preferences — the exact inverse of what this extension is for.
    await applyContentSettings({ ...DEFAULTS, pausedSites: [] });
    expect(cleared).toContain('cookies');
    expect(calls.filter(([type]) => type === 'cookies')).toEqual([]);
  });

  it('never force-allows popups when the popups toggle is off', async () => {
    // Chrome's own default for popups is *block*. Writing 'allow' would
    // leave the browser weaker than if the extension were not installed.
    await applyContentSettings({ popupsDownloads: false });
    expect(cleared).toContain('popups');
    expect(calls.filter(([type]) => type === 'popups')).toEqual([]);
    expect(calls.filter(([type]) => type === 'automaticDownloads')).toEqual([]);
  });

  it('writes no paused-domain exceptions for a type whose toggle is off', async () => {
    // Nothing is blocking, so there is nothing to exempt from — and each
    // exception would be another override of the user's own settings.
    await applyContentSettings({ notifications: false, pausedSites: ['example.com'] });
    expect(calls).toEqual([]);
  });

  it('uses session_only, not block, for cookies', async () => {
    await applyContentSettings({ sessionOnlyCookies: true });
    expect(calls).toContainEqual(['cookies', 'session_only', '<all_urls>']);
  });

  it('sets both camera and microphone from the one cameraMic toggle', async () => {
    await applyContentSettings({ cameraMic: true });
    expect(calls).toContainEqual(['camera', 'block', '<all_urls>']);
    expect(calls).toContainEqual(['microphone', 'block', '<all_urls>']);
  });

  it('does not block camera or microphone on the stock defaults', async () => {
    // The default install path must leave camera and microphone untouched:
    // an extension-set block overrides the user clicking Allow and breaks
    // every in-browser video call. cameraMic is opt-in — off writes nothing.
    await applyContentSettings({ ...DEFAULTS, pausedSites: [] });
    expect(cleared).toContain('camera');
    expect(cleared).toContain('microphone');
    expect(calls.filter(([type]) => type === 'camera' || type === 'microphone')).toEqual([]);
  });

  it('clears each type before writing, so unpausing cannot leave a stale rule', async () => {
    await applyContentSettings({ notifications: true });
    expect(cleared).toContain('notifications');
    const firstSet = chrome.contentSettings.notifications.set.mock.invocationCallOrder[0];
    const clearCall = chrome.contentSettings.notifications.clear.mock.invocationCallOrder[0];
    expect(clearCall).toBeLessThan(firstSet);
  });

  it('writes a more-specific ask rule for every paused domain', async () => {
    await applyContentSettings({ notifications: true, pausedSites: ['example.com'] });
    expect(calls).toContainEqual(['notifications', 'block', '<all_urls>']);
    for (const p of patternsFor('example.com')) {
      expect(calls).toContainEqual(['notifications', 'ask', p]);
    }
  });

  it('exempts a paused domain from every mapped type, not just the prompt ones', async () => {
    await applyContentSettings({ autoplaySound: true, pausedSites: ['example.com'] });
    expect(calls).toContainEqual(['sound', 'block', '<all_urls>']);
    expect(calls).toContainEqual(['sound', 'allow', 'https://*.example.com/*']);
  });

  it('handles several paused domains', async () => {
    await applyContentSettings({ location: true, pausedSites: ['a.com', 'b.org'] });
    expect(calls).toContainEqual(['location', 'ask', 'https://*.a.com/*']);
    expect(calls).toContainEqual(['location', 'ask', 'https://*.b.org/*']);
  });

  it('applies a paused bare-IP host with nothing left unenforced', async () => {
    // Chrome rejects a wildcard subdomain on an IP literal, so stub that
    // rule and let every type run against it. Before patternsFor skipped
    // those patterns, this failed two of four patterns for all eight
    // content-setting types on every apply — a permanent unenforced marker
    // on every toggle in the popup, for a host the user validly paused.
    for (const type of Object.keys(chrome.contentSettings)) {
      const real = chrome.contentSettings[type].set;
      chrome.contentSettings[type].set = vi.fn(async (arg) => {
        if (/:\/\/\*\.\d/.test(arg.primaryPattern)) throw new Error('invalid pattern');
        return real(arg);
      });
    }

    const r = await applyContentSettings({ ...DEFAULTS, pausedSites: ['192.168.1.1'] });

    expect(r.failed).toEqual([]);
    expect(calls).toContainEqual(['location', 'ask', 'https://192.168.1.1/*']);
    expect(r.ok).toContain('location');
  });

  it('writes no per-domain rules when nothing is paused', async () => {
    await applyContentSettings({ notifications: true, pausedSites: [] });
    expect(calls.every(([, , pattern]) => pattern === '<all_urls>')).toBe(true);
  });

  it('reports failures instead of throwing, naming both type and toggle', async () => {
    chrome.contentSettings.sound.set = async () => { throw new Error('unsupported'); };
    const r = await applyContentSettings({ autoplaySound: true });
    expect(r.failed).toEqual([
      { type: 'sound', settingKey: 'autoplaySound', error: 'unsupported' },
    ]);
  });

  it('names the driving toggle when one of a pair fails', async () => {
    chrome.contentSettings.camera.set = async () => { throw new Error('nope'); };
    const r = await applyContentSettings({ cameraMic: true });
    expect(r.failed).toEqual([
      { type: 'camera', settingKey: 'cameraMic', error: 'nope' },
    ]);
    expect(calls).toContainEqual(['microphone', 'block', '<all_urls>']);
  });

  it('keeps applying later map entries after an earlier one fails', async () => {
    chrome.contentSettings.notifications.set = async () => { throw new Error('x'); };
    const r = await applyContentSettings({ notifications: true, sessionOnlyCookies: true });
    expect(r.failed).toHaveLength(1);
    expect(calls).toContainEqual(['cookies', 'session_only', '<all_urls>']);
  });

  it('reports a failing clear without aborting the other types', async () => {
    chrome.contentSettings.notifications.clear = async () => { throw new Error('clear failed'); };
    const r = await applyContentSettings({ notifications: true, location: true });
    expect(r.failed).toEqual([
      { type: 'notifications', settingKey: 'notifications', error: 'clear failed' },
    ]);
    expect(calls).toContainEqual(['location', 'block', '<all_urls>']);
  });

  it('keeps writing later paused domains after one pattern is rejected', async () => {
    // Chrome's match-pattern parser rejects IP literals and trailing-dot
    // hosts. Sharing one try/catch with the whole type meant a single bad
    // domain dropped every exemption after it while the global block stayed
    // in force — a site the icon calls paused, still being blocked.
    const bad = 'http://192.168.1.1/*';
    const real = chrome.contentSettings.location.set;
    chrome.contentSettings.location.set = vi.fn(async (arg) => {
      if (arg.primaryPattern === bad) throw new Error('invalid pattern');
      return real(arg);
    });

    const r = await applyContentSettings({
      location: true,
      pausedSites: ['192.168.1.1', 'later.com'],
    });

    // The domain after the failure still gets its full exemption set.
    for (const p of patternsFor('later.com')) {
      expect(calls).toContainEqual(['location', 'ask', p]);
    }
    // And so do the patterns of the bad domain that Chrome did accept.
    expect(calls).toContainEqual(['location', 'ask', 'https://192.168.1.1/*']);
    // The failure is reported rather than swallowed.
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]).toMatchObject({ type: 'location', settingKey: 'location' });
    expect(r.failed[0].error).toContain(bad);
    // A type with a missing exemption is not reported as fully applied.
    expect(r.ok).not.toContain('location');
  });

  it('survives a rejection that is not an Error', async () => {
    chrome.contentSettings.sound.set = async () => { throw 'plain string'; };
    const r = await applyContentSettings({ autoplaySound: true });
    expect(r.failed[0].error).toBe('plain string');
  });
});
