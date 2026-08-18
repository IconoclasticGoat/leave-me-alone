// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { injectGpc } from '../src/content/gpc-inject.js';

beforeEach(() => {
  document.documentElement.innerHTML = '<head></head><body></body>';
  globalThis.chrome = { runtime: { getURL: (p) => `chrome-extension://abc/${p}` } };
});

describe('injectGpc', () => {
  it('appends a MAIN-world script when the toggle is on', () => {
    injectGpc(document, { gpc: true });
    const s = document.querySelector('script[src*="gpc-main.js"]');
    expect(s).not.toBe(null);
    expect(s.src).toBe('chrome-extension://abc/gpc-main.js');
  });

  it('injects nothing when the toggle is off', () => {
    injectGpc(document, { gpc: false });
    expect(document.querySelector('script[src*="gpc-main.js"]')).toBe(null);
  });

  it('does not inject twice', () => {
    injectGpc(document, { gpc: true });
    injectGpc(document, { gpc: true });
    expect(document.querySelectorAll('script[src*="gpc-main.js"]')).toHaveLength(1);
  });

  it('injects nothing on a paused host', () => {
    injectGpc(document, { gpc: true, pausedSites: ['example.com'] }, 'example.com');
    expect(document.querySelector('script[src*="gpc-main.js"]')).toBe(null);
  });

  it('injects nothing on a subdomain of a paused host', () => {
    injectGpc(document, { gpc: true, pausedSites: ['example.com'] }, 'www.example.com');
    expect(document.querySelector('script[src*="gpc-main.js"]')).toBe(null);
  });

  it('still injects on a host that is not paused', () => {
    injectGpc(document, { gpc: true, pausedSites: ['other.com'] }, 'example.com');
    expect(document.querySelector('script[src*="gpc-main.js"]')).not.toBe(null);
  });
});
