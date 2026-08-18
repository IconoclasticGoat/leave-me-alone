import { beforeEach, describe, it, expect, vi } from 'vitest';
import { hostnameOf, actionStateFor, stampTab, stampAllTabs } from '../src/background/action.js';

let setIcon, setTitle, query;
beforeEach(() => {
  setIcon = vi.fn(async () => {});
  setTitle = vi.fn(async () => {});
  query = vi.fn(async () => []);
  globalThis.chrome = { action: { setIcon, setTitle }, tabs: { query } };
});

describe('hostnameOf', () => {
  it('pulls the host out of a normal url', () => {
    expect(hostnameOf('https://www.example.com/a/b?c=1')).toBe('www.example.com');
  });

  it('returns null for urls with no host', () => {
    // chrome://, about:blank and the new tab page all land here. They must
    // fall through to the active default rather than throwing.
    expect(hostnameOf('about:blank')).toBe(null);
    expect(hostnameOf('chrome://extensions')).toBe(null);
  });

  it('returns null for junk instead of throwing', () => {
    expect(hostnameOf('not a url')).toBe(null);
    expect(hostnameOf(undefined)).toBe(null);
  });
});

describe('actionStateFor', () => {
  it('uses the paused icon and names the host on a paused site', () => {
    const s = actionStateFor({ pausedSites: ['example.com'] }, 'https://example.com/');
    expect(s.path[16]).toBe('icons/paused-16.png');
    expect(s.title).toBe('Leave Me Alone — paused on example.com');
  });

  it('treats a subdomain of a paused domain as paused', () => {
    const s = actionStateFor({ pausedSites: ['example.com'] }, 'https://shop.example.com/');
    expect(s.path[16]).toBe('icons/paused-16.png');
    expect(s.title).toBe('Leave Me Alone — paused on shop.example.com');
  });

  it('uses the active icon and the plain title elsewhere', () => {
    const s = actionStateFor({ pausedSites: ['example.com'] }, 'https://other.com/');
    expect(s.path[16]).toBe('icons/active-16.png');
    expect(s.title).toBe('Leave Me Alone');
  });

  it('falls back to active for a url with no host', () => {
    const s = actionStateFor({ pausedSites: ['example.com'] }, 'chrome://extensions');
    expect(s.path[16]).toBe('icons/active-16.png');
    expect(s.title).toBe('Leave Me Alone');
  });

  it('offers all four sizes so Chrome can pick per display density', () => {
    const s = actionStateFor({}, 'https://example.com/');
    expect(Object.keys(s.path).sort()).toEqual(['128', '16', '32', '48']);
  });
});

describe('stampTab', () => {
  it('sets both icon and title against the given tab', async () => {
    await stampTab(7, 'https://example.com/', { pausedSites: ['example.com'] });
    expect(setIcon).toHaveBeenCalledWith({ tabId: 7, path: expect.objectContaining({ 16: 'icons/paused-16.png' }) });
    expect(setTitle).toHaveBeenCalledWith({ tabId: 7, title: 'Leave Me Alone — paused on example.com' });
  });

  it('swallows the error when the tab has already closed', async () => {
    // A tab can close between the event firing and the stamp landing.
    // That is routine, not an error worth surfacing.
    chrome.action.setIcon = async () => { throw new Error('No tab with id: 7'); };
    await expect(stampTab(7, 'https://example.com/', {})).resolves.toBeUndefined();
  });

  it('logs unexpected errors to console.debug without throwing', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      chrome.action.setIcon = async () => { throw new Error('Unexpected failure'); };
      await expect(stampTab(7, 'https://example.com/', {})).resolves.toBeUndefined();
      // The icon path is logged too: a persistent failure is almost always a
      // wrong path, and that should be a one-glance diagnosis.
      expect(debugSpy).toHaveBeenCalledWith('stampTab failed', expect.objectContaining({
        tabId: 7,
        path: expect.objectContaining({ 16: 'icons/active-16.png' }),
      }));
    } finally {
      debugSpy.mockRestore();
    }
  });
});

describe('stampAllTabs', () => {
  it('stamps every open tab', async () => {
    query.mockResolvedValue([
      { id: 1, url: 'https://example.com/' },
      { id: 2, url: 'https://other.com/' },
    ]);
    await stampAllTabs({ pausedSites: ['example.com'] });
    expect(setTitle).toHaveBeenCalledWith({ tabId: 1, title: 'Leave Me Alone — paused on example.com' });
    expect(setTitle).toHaveBeenCalledWith({ tabId: 2, title: 'Leave Me Alone' });
  });

  it('skips tabs with no id or no url', async () => {
    // tabs.query omits url for tabs we lack host permission on.
    query.mockResolvedValue([{ id: 3 }, { url: 'https://example.com/' }]);
    await stampAllTabs({});
    expect(setIcon).not.toHaveBeenCalled();
  });
});
