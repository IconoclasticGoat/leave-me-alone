import { beforeEach, describe, it, expect, vi } from 'vitest';
import { applyContentSettings, releaseValueFor, patternsFor } from '../src/background/content-settings.js';

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
});

describe('applyContentSettings', () => {
  it('blocks notifications and location when their toggles are on', async () => {
    await applyContentSettings({ notifications: true, location: true });
    expect(calls).toContainEqual(['notifications', 'block', '<all_urls>']);
    expect(calls).toContainEqual(['location', 'block', '<all_urls>']);
  });

  it('releases to ask, not allow, when a toggle is off', async () => {
    // Writing 'allow' here would override the user's own per-site blocks
    // with no route back. 'ask' hands the decision to Chrome's dialog.
    await applyContentSettings({ notifications: false });
    expect(calls).toContainEqual(['notifications', 'ask', '<all_urls>']);
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

  it('survives a rejection that is not an Error', async () => {
    chrome.contentSettings.sound.set = async () => { throw 'plain string'; };
    const r = await applyContentSettings({ autoplaySound: true });
    expect(r.failed[0].error).toBe('plain string');
  });
});
