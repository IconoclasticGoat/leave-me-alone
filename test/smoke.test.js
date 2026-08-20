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
    //
    // `declarativeNetRequestWithHostAccess`, not `declarativeNetRequest`: the
    // plain form adds a separate "Block content on any page" warning to the
    // install prompt, while the WithHostAccess form adds none and instead
    // leans on the host permissions asserted below. Since `<all_urls>` is
    // already granted, every rule keeps working — including the block rules,
    // which under the plain permission would not have needed host access at
    // all. Swapping back would cost a warning line and buy nothing.
    expect(new Set(m.permissions)).toEqual(new Set([
      'storage', 'contentSettings', 'declarativeNetRequestWithHostAccess',
    ]));
  });

  it('declares all_urls and nothing wider', () => {
    // Two things genuinely require this, and neither has a narrower form:
    // the `modifyHeaders` GPC rule (header modification needs host access to
    // the request URL) and reading `tab.url` for per-tab icon stamping.
    // contentSettings, the DNR *block* rules, and the content scripts do not
    // — but the content scripts' own `<all_urls>` matches already produce the
    // identical install warning, so narrowing this line alone would break GPC
    // and change the prompt by nothing. See docs/KNOWN-ISSUES.md.
    expect(m.host_permissions ?? []).toEqual(['<all_urls>']);
  });

  it('has a service worker of type module', () => {
    expect(m.background.type).toBe('module');
  });

  it('declares the active icon as its default at every size', () => {
    // A tab the service worker has not stamped yet must look active, not blank.
    for (const size of ['16', '32', '48', '128']) {
      expect(m.icons[size]).toBe(`icons/active-${size}.png`);
      expect(m.action.default_icon[size]).toBe(`icons/active-${size}.png`);
    }
  });
});
