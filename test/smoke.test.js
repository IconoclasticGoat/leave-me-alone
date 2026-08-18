// test/smoke.test.js
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

describe('manifest', () => {
  const m = JSON.parse(readFileSync('manifest.json', 'utf8'));

  it('is manifest v3', () => expect(m.manifest_version).toBe(3));

  it('requests exactly the permissions we need, and no more', () => {
    // No `scripting`: content scripts are declared statically and the GPC
    // injector uses web_accessible_resources, not programmatic injection.
    // Unused permissions widen the install prompt and draw store-review scrutiny.
    expect(new Set(m.permissions)).toEqual(new Set([
      'storage', 'contentSettings', 'declarativeNetRequest',
    ]));
  });

  it('declares no host permissions beyond all_urls for the content script', () => {
    expect(m.host_permissions ?? []).toEqual(['<all_urls>']);
  });

  it('has a service worker of type module', () => {
    expect(m.background.type).toBe('module');
  });
});
