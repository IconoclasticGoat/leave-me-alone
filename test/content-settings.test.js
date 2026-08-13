import { beforeEach, describe, it, expect, vi } from 'vitest';
import { applyContentSettings } from '../src/background/content-settings.js';

let calls;
const stub = (name) => ({ set: vi.fn(async (arg) => { calls.push([name, arg.setting]); }) });

beforeEach(() => {
  calls = [];
  globalThis.chrome = { contentSettings: {
    notifications: stub('notifications'), location: stub('location'),
    camera: stub('camera'), microphone: stub('microphone'),
    popups: stub('popups'), automaticDownloads: stub('automaticDownloads'),
    sound: stub('sound'), cookies: stub('cookies'),
  }};
});

describe('applyContentSettings', () => {
  it('blocks notifications and location when their toggles are on', async () => {
    await applyContentSettings({ notifications: true, location: true });
    expect(calls).toContainEqual(['notifications', 'block']);
    expect(calls).toContainEqual(['location', 'block']);
  });

  it('restores to allow when a toggle is off', async () => {
    await applyContentSettings({ notifications: false });
    expect(calls).toContainEqual(['notifications', 'allow']);
  });

  it('uses session_only, not block, for cookies', async () => {
    await applyContentSettings({ sessionOnlyCookies: true });
    expect(calls).toContainEqual(['cookies', 'session_only']);
  });

  it('sets both camera and microphone from the one cameraMic toggle', async () => {
    await applyContentSettings({ cameraMic: true });
    expect(calls).toContainEqual(['camera', 'block']);
    expect(calls).toContainEqual(['microphone', 'block']);
  });

  it('reports failures instead of throwing', async () => {
    chrome.contentSettings.sound.set = async () => { throw new Error('unsupported'); };
    const r = await applyContentSettings({ autoplaySound: true });
    expect(r.failed).toEqual([{ key: 'sound', error: 'unsupported' }]);
  });
});
