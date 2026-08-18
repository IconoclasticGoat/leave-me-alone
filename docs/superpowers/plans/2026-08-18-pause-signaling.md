# Pause Signaling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "paused on this site" visible in the toolbar and popup, and widen pause so it covers every enforcement layer rather than only the DOM one.

**Architecture:** Pause currently short-circuits only the content script. Tasks 1–3 extend it to `chrome.contentSettings` (per-origin exceptions), `declarativeNetRequest` (dynamic rules with domain exclusions), and the GPC injector. Tasks 4–6 then signal that state: an icon set with active and paused variants, a service-worker module that stamps each tab's icon and tooltip, and a paused banner in the popup. Task 7 updates the docs.

**Tech Stack:** Chrome MV3, vanilla ES modules, esbuild, vitest + jsdom, `@resvg/resvg-js` (dev-only, for icon rasterisation).

**Spec:** [docs/superpowers/specs/2026-08-18-pause-signaling-design.md](../specs/2026-08-18-pause-signaling-design.md)

## Global Constraints

- **Zero runtime dependencies.** `@resvg/resvg-js` is a devDependency only; nothing new ships in `dist/`.
- **No new manifest permissions.** `<all_urls>` already makes `tab.url` readable. `test/smoke.test.js` asserts the exact permission set and must keep passing.
- **Node >= 20**, ESM throughout, esbuild target `chrome120`.
- **Tests live only in `test/**/*.test.js`** — `vitest.config.js` uses an allowlist deliberately; do not widen it.
- **Active icon tint:** `#5b60d6`. **Paused tint:** `#9aa0a6`. One palette serves both light and dark toolbars — MV3 exposes no toolbar-theme signal.
- **Paused bar rotation:** exactly `-30` degrees about the icon centre `(24, 24)`.
- **Banner copy, verbatim, Oxford comma included:** `Nothing is being blocked here. Cookie banners, prompts, and trackers all behave as the site intends.`
- **Paused tooltip, verbatim:** `Leave Me Alone — paused on <host>` (em dash).
- **Never break a page or abort a batch on one failure.** Existing code collects per-type failures into `lastApplyErrors`; preserve that.

---

### Task 1: Content settings — release to `ask`, and exempt paused sites

Chrome has no API to remove a single content-setting pattern (`clear()` wipes everything the extension set for a type), so `applyContentSettings` becomes a full reconciliation: clear, write the global rule, then write a more-specific rule per paused domain. More specific patterns win.

Three types reject `'ask'` and must release to `'allow'` instead: `popups`, `sound`, `cookies`.

**Files:**
- Modify: `src/background/content-settings.js`
- Test: `test/content-settings.test.js`

**Interfaces:**
- Consumes: `settings` object from `getSettings()`, which already includes `pausedSites: string[]` (see `SHAPE` in `src/settings.js:18`).
- Produces: `applyContentSettings(settings)` → `{ ok: string[], failed: Array<{type, settingKey, error}> }`. Signature unchanged. Also exports `releaseValueFor(type)` and `patternsFor(domain)`.

- [ ] **Step 1: Rewrite the test file**

The existing stub only mocks `set`. Reconciliation also calls `clear`, and assertions now need the pattern, not just the value — so `calls` records triples.

Replace the whole of `test/content-settings.test.js` with:

```js
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
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run test/content-settings.test.js`
Expected: FAIL — `releaseValueFor is not a function`, plus pattern assertions failing.

- [ ] **Step 3: Rewrite the implementation**

Replace the whole of `src/background/content-settings.js` with:

```js
// Maps one settings key to one or more chrome.contentSettings types.
// `blocked` is the value applied when the toggle is ON.
const MAP = [
  { key: 'notifications',   types: ['notifications'],                  blocked: 'block' },
  { key: 'location',        types: ['location'],                       blocked: 'block' },
  { key: 'cameraMic',       types: ['camera', 'microphone'],           blocked: 'block' },
  { key: 'popupsDownloads', types: ['popups', 'automaticDownloads'],   blocked: 'block' },
  { key: 'autoplaySound',   types: ['sound'],                          blocked: 'block' },
  { key: 'sessionOnlyCookies', types: ['cookies'],                     blocked: 'session_only' },
];

// Chrome rejects 'ask' for these three — popups and sound take only
// allow/block, cookies takes allow/block/session_only. Everything else
// releases to 'ask' so the decision goes back to the user rather than
// being granted on their behalf.
const NO_ASK = new Set(['popups', 'sound', 'cookies']);

export function releaseValueFor(type) {
  return NO_ASK.has(type) ? 'allow' : 'ask';
}

// A paused site needs a pattern more specific than '<all_urls>' to win.
// Both schemes, and both the bare domain and its subdomains, matching how
// isPaused() treats a stored domain.
export function patternsFor(domain) {
  return [
    `http://${domain}/*`, `https://${domain}/*`,
    `http://*.${domain}/*`, `https://*.${domain}/*`,
  ];
}

export async function applyContentSettings(settings) {
  const ok = [];
  const failed = [];
  const paused = settings.pausedSites ?? [];

  for (const { key, types, blocked } of MAP) {
    const global = settings[key] ? blocked : null;
    for (const type of types) {
      try {
        // No API removes a single pattern, so every apply is a full
        // reconciliation: wipe what we wrote last time, then rewrite it.
        // Without this, unpausing would leave its exception behind forever.
        await chrome.contentSettings[type].clear({});
        await chrome.contentSettings[type].set({
          primaryPattern: '<all_urls>',
          setting: global ?? releaseValueFor(type),
        });
        for (const domain of paused) {
          for (const primaryPattern of patternsFor(domain)) {
            await chrome.contentSettings[type].set({
              primaryPattern,
              setting: releaseValueFor(type),
            });
          }
        }
        ok.push(type);
      } catch (e) {
        // `sound` requires Chrome 141+; older builds reject it. Report, don't throw.
        failed.push({ type, settingKey: key, error: e?.message ?? String(e) });
      }
    }
  }
  return { ok, failed };
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run test/content-settings.test.js`
Expected: PASS, 17 tests.

- [ ] **Step 5: Run the full suite to catch regressions**

Run: `npm test`
Expected: PASS. No other test touches content settings.

- [ ] **Step 6: Commit**

```bash
git add src/background/content-settings.js test/content-settings.test.js
git commit -m "Release content settings to ask, and exempt paused sites"
```

---

### Task 2: Dynamic network rules with paused-domain exclusions

Static rulesets are all-or-nothing — they cannot carry per-site exclusions. All three are a single rule each, so converting them to dynamic rules rebuilt on every apply is cheap.

**Files:**
- Modify: `src/background/rulesets.js`
- Modify: `manifest.json` (remove the `declarative_net_request` block)
- Modify: `build.mjs` (stop copying `rules/`, now bundled by esbuild)
- Test: `test/rulesets.test.js`

**Interfaces:**
- Consumes: `settings` including `pausedSites`.
- Produces: `buildDynamicRules(settings)` → array of DNR rule objects; `applyRulesets(settings)` → Promise; `RULE_IDS` → `[1, 2, 3]`.

- [ ] **Step 1: Rewrite the test file**

Replace the whole of `test/rulesets.test.js` with:

```js
import { readFileSync } from 'node:fs';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { applyRulesets, buildDynamicRules, RULE_IDS } from '../src/background/rulesets.js';

let update;
beforeEach(() => {
  update = vi.fn(async () => {});
  globalThis.chrome = { declarativeNetRequest: { updateDynamicRules: update } };
});

describe('rule sources', () => {
  it('gpc rule sets the Sec-GPC header on every request', () => {
    const r = JSON.parse(readFileSync('rules/gpc.json', 'utf8'))[0];
    expect(r.action.type).toBe('modifyHeaders');
    const h = r.action.requestHeaders[0];
    expect(h).toMatchObject({ header: 'Sec-GPC', operation: 'set', value: '1' });
    expect(r.condition.urlFilter).toBe('*');
  });
});

describe('buildDynamicRules', () => {
  it('includes only the rules whose toggles are on', () => {
    const rules = buildDynamicRules({ gpc: true, googleOneTap: false, chatWidgets: true });
    expect(rules.map((r) => r.id)).toEqual([1, 3]);
  });

  it('returns nothing when every toggle is off', () => {
    expect(buildDynamicRules({})).toEqual([]);
  });

  it('gives each rule a stable id so removeRuleIds can always clear them', () => {
    const a = buildDynamicRules({ gpc: true, googleOneTap: true, chatWidgets: true });
    const b = buildDynamicRules({ gpc: true, googleOneTap: true, chatWidgets: true });
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id));
    expect(RULE_IDS).toEqual([1, 2, 3]);
  });

  it('excludes paused domains as both request and initiator', () => {
    // main_frame requests have no initiator, so requestDomains is what
    // exempts the paused page itself; initiatorDomains exempts the
    // subresources that page goes on to load.
    const [rule] = buildDynamicRules({ gpc: true, pausedSites: ['example.com'] });
    expect(rule.condition.excludedRequestDomains).toEqual(['example.com']);
    expect(rule.condition.excludedInitiatorDomains).toEqual(['example.com']);
  });

  it('omits the exclusion keys entirely when nothing is paused', () => {
    // declarativeNetRequest rejects empty arrays for these fields.
    const [rule] = buildDynamicRules({ gpc: true, pausedSites: [] });
    expect('excludedRequestDomains' in rule.condition).toBe(false);
    expect('excludedInitiatorDomains' in rule.condition).toBe(false);
  });

  it('preserves the original condition alongside the exclusions', () => {
    const [rule] = buildDynamicRules({ chatWidgets: true, pausedSites: ['example.com'] });
    expect(rule.condition.requestDomains).toContain('widget.intercom.io');
    expect(rule.condition.excludedInitiatorDomains).toEqual(['example.com']);
  });

  it('does not mutate the imported rule source between calls', () => {
    buildDynamicRules({ gpc: true, pausedSites: ['example.com'] });
    const [rule] = buildDynamicRules({ gpc: true, pausedSites: [] });
    expect('excludedRequestDomains' in rule.condition).toBe(false);
  });
});

describe('applyRulesets', () => {
  it('clears every id and adds the current set in one call', async () => {
    await applyRulesets({ gpc: true, googleOneTap: false, chatWidgets: false });
    expect(update).toHaveBeenCalledWith({
      removeRuleIds: [1, 2, 3],
      addRules: buildDynamicRules({ gpc: true }),
    });
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run test/rulesets.test.js`
Expected: FAIL — `buildDynamicRules is not a function`.

- [ ] **Step 3: Rewrite the implementation**

Replace the whole of `src/background/rulesets.js` with:

```js
import gpc from '../../rules/gpc.json';
import oneTap from '../../rules/one-tap.json';
import chatWidgets from '../../rules/chat-widgets.json';

// Static rulesets can only be toggled wholesale, which cannot express
// "everywhere except these domains". Dynamic rules can, so the JSON files
// are now rule *sources* rebuilt on every apply rather than shipped rulesets.
const SOURCES = [
  { key: 'gpc',          id: 1, rule: gpc[0] },
  { key: 'googleOneTap', id: 2, rule: oneTap[0] },
  { key: 'chatWidgets',  id: 3, rule: chatWidgets[0] },
];

export const RULE_IDS = SOURCES.map((s) => s.id);

export function buildDynamicRules(settings) {
  const paused = settings.pausedSites ?? [];
  return SOURCES.filter(({ key }) => settings[key]).map(({ id, rule }) => {
    const condition = { ...rule.condition };
    if (paused.length > 0) {
      // Both keys: requestDomains covers the paused main_frame itself
      // (which has no initiator), initiatorDomains covers what it loads.
      // Empty arrays are rejected by Chrome, hence the length guard.
      condition.excludedRequestDomains = paused;
      condition.excludedInitiatorDomains = paused;
    }
    return { ...rule, id, condition };
  });
}

export async function applyRulesets(settings) {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: RULE_IDS,
    addRules: buildDynamicRules(settings),
  });
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run test/rulesets.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Drop the static ruleset declaration from the manifest**

In `manifest.json`, delete this trailing block (and the comma ending the `web_accessible_resources` line before it):

```json
  "declarative_net_request": {
    "rule_resources": [
      { "id": "gpc", "enabled": false, "path": "rules/gpc.json" },
      { "id": "one-tap", "enabled": false, "path": "rules/one-tap.json" },
      { "id": "chat-widgets", "enabled": false, "path": "rules/chat-widgets.json" }
    ]
  }
```

The `declarativeNetRequest` **permission** stays — dynamic rules need it.

- [ ] **Step 6: Stop copying `rules/` into dist**

In `build.mjs`, the JSON is now bundled into `background.js` by esbuild's json loader, so the directory no longer needs copying. Change:

```js
for (const f of ['manifest.json', 'rules', 'popup/popup.html', 'popup/popup.css']) {
```

to:

```js
for (const f of ['manifest.json', 'popup/popup.html', 'popup/popup.css']) {
```

- [ ] **Step 7: Verify the build and full suite**

Run: `npm run build && npm test`
Expected: `built dist/` then PASS. Confirm `dist/rules` is absent and `dist/background.js` contains `intercom` (proof the JSON was bundled):

```bash
test ! -d dist/rules && grep -q intercom dist/background.js && echo "bundled ok"
```

- [ ] **Step 8: Commit**

```bash
git add src/background/rulesets.js test/rulesets.test.js manifest.json build.mjs
git commit -m "Convert network rules to dynamic rules that exempt paused sites"
```

---

### Task 3: GPC injector respects pause

`src/content/index.js:76` already guards on `isPaused`. The GPC injector does not, so a paused site still gets `navigator.globalPrivacyControl`.

**Files:**
- Modify: `src/content/gpc-inject.js`
- Test: `test/gpc.test.js`

**Interfaces:**
- Consumes: `isPaused(settings, hostname)` from `src/settings.js`.
- Produces: `injectGpc(doc, settings, hostname)` — third parameter added, defaulting to `location.hostname`. Returns the script element, or `null` when it injected nothing.

- [ ] **Step 1: Add the failing tests**

Append to `test/gpc.test.js`, inside the existing `describe('injectGpc', ...)` block:

```js
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
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run test/gpc.test.js`
Expected: FAIL — the first two inject a script when they should not.

- [ ] **Step 3: Add the guard**

In `src/content/gpc-inject.js`, change the import line to pull in `isPaused`:

```js
import { getSettings, isPaused } from '../settings.js';
```

Change the `injectGpc` signature and add the guard as its second line:

```js
export function injectGpc(doc, settings, hostname = location.hostname) {
  if (!settings?.gpc) return null;
  if (isPaused(settings, hostname)) return null;
  if (doc.querySelector(`script[${MARKER}]`)) return null;
```

The rest of the function is unchanged. `main()` needs no edit — the hostname default covers it.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run test/gpc.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/content/gpc-inject.js test/gpc.test.js
git commit -m "Stop sending GPC on paused sites"
```

---

### Task 4: Icon assets and build pipeline

The extension currently declares no icons at all, so Chrome renders a grey letter placeholder. This task creates the SVG sources, a rasteriser script, the committed PNGs, and the manifest declarations.

**Files:**
- Create: `assets/icon.svg`, `assets/icon-paused.svg`
- Create: `scripts/build-icons.mjs`
- Create: `icons/active-{16,32,48,128}.png`, `icons/paused-{16,32,48,128}.png` (generated)
- Modify: `package.json` (devDependency + `icons` script)
- Modify: `manifest.json` (`icons`, `action.default_icon`)
- Modify: `build.mjs` (copy `icons/` into dist)
- Test: `test/icons.test.js`, `test/smoke.test.js`

**Interfaces:**
- Produces: PNG files at the exact paths `icons/active-<size>.png` and `icons/paused-<size>.png` for sizes 16, 32, 48, 128. Task 5 and Task 6 both reference these paths.

- [ ] **Step 1: Write the active icon source**

Create `assets/icon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">
  <mask id="bar">
    <rect width="48" height="48" fill="#fff"/>
    <rect x="11" y="21" width="26" height="6" rx="3" fill="#000"/>
  </mask>
  <circle cx="24" cy="24" r="20" fill="#5b60d6" mask="url(#bar)"/>
</svg>
```

- [ ] **Step 2: Write the paused icon source**

Create `assets/icon-paused.svg`. Identical but for the tint and the `-30` degree rotation of the bar about the centre — the bar has fallen off its hinge.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">
  <mask id="bar">
    <rect width="48" height="48" fill="#fff"/>
    <rect x="11" y="21" width="26" height="6" rx="3" fill="#000" transform="rotate(-30 24 24)"/>
  </mask>
  <circle cx="24" cy="24" r="20" fill="#9aa0a6" mask="url(#bar)"/>
</svg>
```

- [ ] **Step 3: Add the rasteriser as a devDependency**

Run: `npm install --save-dev @resvg/resvg-js`
Expected: `package.json` gains `@resvg/resvg-js` under `devDependencies`; nothing changes under `dependencies` (there are none, and there must remain none).

- [ ] **Step 4: Write the build script**

Create `scripts/build-icons.mjs`:

```js
// Rasterises the two icon sources to the PNG sizes Chrome needs. The
// generated PNGs are committed, so `npm run build` never needs resvg —
// only `npm run icons` does, and only when the artwork changes.
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const SIZES = [16, 32, 48, 128];
const VARIANTS = [
  ['active', 'assets/icon.svg'],
  ['paused', 'assets/icon-paused.svg'],
];

mkdirSync('icons', { recursive: true });

for (const [name, src] of VARIANTS) {
  const svg = readFileSync(src, 'utf8');
  for (const size of SIZES) {
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } })
      .render()
      .asPng();
    writeFileSync(`icons/${name}-${size}.png`, png);
    console.log(`icons/${name}-${size}.png`);
  }
}
```

- [ ] **Step 5: Add the npm script**

In `package.json`, add to `scripts`:

```json
    "icons": "node scripts/build-icons.mjs",
```

- [ ] **Step 6: Generate the PNGs**

Run: `npm run icons`
Expected: eight lines of output, one per file, and eight files in `icons/`.

- [ ] **Step 7: Write the icon test**

Create `test/icons.test.js`:

```js
import { readFileSync, existsSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const SIZES = [16, 32, 48, 128];
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe('icon assets', () => {
  for (const variant of ['active', 'paused']) {
    for (const size of SIZES) {
      const path = `icons/${variant}-${size}.png`;

      it(`ships ${path} as a real PNG`, () => {
        expect(existsSync(path)).toBe(true);
        const buf = readFileSync(path);
        expect(buf.subarray(0, 4)).toEqual(PNG_MAGIC);
        // Width lives in bytes 16-20 of the IHDR chunk, big-endian.
        expect(buf.readUInt32BE(16)).toBe(size);
      });
    }
  }

  it('draws the paused bar rotated and the active bar level', () => {
    // The rotation is the whole signal — if a refactor drops the transform,
    // the two icons become distinguishable only by colour, which fails for
    // colourblind users and in greyscale.
    expect(readFileSync('assets/icon-paused.svg', 'utf8')).toContain('rotate(-30 24 24)');
    expect(readFileSync('assets/icon.svg', 'utf8')).not.toContain('rotate');
  });
});
```

- [ ] **Step 8: Declare the icons in the manifest**

In `manifest.json`, add these two blocks. `icons` sits at the top level (used by the extensions page and store listing); `default_icon` goes inside the existing `action` object, which currently holds only `default_popup`.

```json
  "icons": {
    "16": "icons/active-16.png",
    "32": "icons/active-32.png",
    "48": "icons/active-48.png",
    "128": "icons/active-128.png"
  },
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/active-16.png",
      "32": "icons/active-32.png",
      "48": "icons/active-48.png",
      "128": "icons/active-128.png"
    }
  },
```

- [ ] **Step 9: Add the manifest assertion**

Append to the `describe('manifest', ...)` block in `test/smoke.test.js`:

```js
  it('declares the active icon as its default at every size', () => {
    // A tab the service worker has not stamped yet must look active, not blank.
    for (const size of ['16', '32', '48', '128']) {
      expect(m.icons[size]).toBe(`icons/active-${size}.png`);
      expect(m.action.default_icon[size]).toBe(`icons/active-${size}.png`);
    }
  });
```

- [ ] **Step 10: Copy icons into dist**

In `build.mjs`, add `'icons'` to the copy list:

```js
for (const f of ['manifest.json', 'icons', 'popup/popup.html', 'popup/popup.css']) {
```

- [ ] **Step 11: Verify**

Run: `npm run build && npm test`
Expected: PASS. Then confirm the icons landed:

```bash
ls dist/icons | wc -l
```

Expected: `8`.

- [ ] **Step 12: Commit**

```bash
git add assets scripts/build-icons.mjs icons package.json package-lock.json manifest.json build.mjs test/icons.test.js test/smoke.test.js
git commit -m "Add icon set with active and paused variants"
```

---

### Task 5: Per-tab icon and tooltip

**Files:**
- Create: `src/background/action.js`
- Modify: `src/background/index.js`
- Test: `test/action.test.js`

**Interfaces:**
- Consumes: `isPaused(settings, hostname)` from `src/settings.js`; the PNG paths from Task 4.
- Produces:
  - `hostnameOf(url)` → `string | null`
  - `actionStateFor(settings, url)` → `{ path: Record<string,string>, title: string }`
  - `stampTab(tabId, url, settings)` → `Promise<void>`
  - `stampAllTabs(settings)` → `Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `test/action.test.js`:

```js
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
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run test/action.test.js`
Expected: FAIL — cannot resolve `../src/background/action.js`.

- [ ] **Step 3: Write the module**

Create `src/background/action.js`:

```js
import { isPaused } from '../settings.js';

const SIZES = [16, 32, 48, 128];

const pathsFor = (variant) =>
  Object.fromEntries(SIZES.map((s) => [s, `icons/${variant}-${s}.png`]));

const ACTIVE = pathsFor('active');
const PAUSED = pathsFor('paused');

export function hostnameOf(url) {
  try {
    return new URL(url).hostname || null;
  } catch {
    // chrome://, about:blank, undefined during teardown — all mean
    // "no site here", which is not an error.
    return null;
  }
}

export function actionStateFor(settings, url) {
  const host = hostnameOf(url);
  if (host && isPaused(settings, host)) {
    return { path: PAUSED, title: `Leave Me Alone — paused on ${host}` };
  }
  return { path: ACTIVE, title: 'Leave Me Alone' };
}

export async function stampTab(tabId, url, settings) {
  const { path, title } = actionStateFor(settings, url);
  try {
    await Promise.all([
      chrome.action.setIcon({ tabId, path }),
      chrome.action.setTitle({ tabId, title }),
    ]);
  } catch {
    // The tab closed between the event and this call. Routine.
  }
}

export async function stampAllTabs(settings) {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs
      .filter((t) => t.id !== undefined && t.url)
      .map((t) => stampTab(t.id, t.url, settings))
  );
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run test/action.test.js`
Expected: PASS, 12 tests.

- [ ] **Step 5: Wire the listeners into the service worker**

Replace the whole of `src/background/index.js` with:

```js
import { getSettings } from '../settings.js';
import { applyContentSettings } from './content-settings.js';
import { applyRulesets } from './rulesets.js';
import { stampAllTabs, stampTab } from './action.js';

async function applyAll() {
  const settings = await getSettings();
  const [cs] = await Promise.all([
    applyContentSettings(settings),
    // A ruleset failure must not stop the content-settings error report
    // below from being written — the popup depends on it.
    applyRulesets(settings).catch((e) => {
      console.error('applyRulesets failed', e);
    }),
    stampAllTabs(settings).catch((e) => {
      console.error('stampAllTabs failed', e);
    }),
  ]);
  // Surfaced by the popup so a toggle can never claim enforcement it didn't get.
  await chrome.storage.local.set({ lastApplyErrors: cs.failed });
}

chrome.runtime.onInstalled.addListener(applyAll);
chrome.runtime.onStartup.addListener(applyAll);
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'sync') applyAll();
});

// Per-tab icon state. tab.url is readable without the "tabs" permission
// because host_permissions covers <all_urls> — the popup already relies
// on this. A navigation wakes the service worker, so no state is lost
// when it has been suspended.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== 'loading') return;
  await stampTab(tabId, tab.url, await getSettings());
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab) await stampTab(tabId, tab.url, await getSettings());
});
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Verify the service worker still builds**

Run: `npm run build`
Expected: `built dist/`. Confirm the icon paths made it in:

```bash
grep -q "icons/paused-16.png" dist/background.js && echo "wired ok"
```

- [ ] **Step 8: Commit**

```bash
git add src/background/action.js src/background/index.js test/action.test.js
git commit -m "Show a paused icon and tooltip per tab"
```

---

### Task 6: Paused state in the popup

The toolbar is invisible when the extension is unpinned, so the popup carries the state independently.

**Files:**
- Modify: `popup/popup.html`
- Modify: `popup/popup.css`
- Modify: `popup/popup.js`
- Test: `test/popup.test.js`

**Interfaces:**
- Consumes: `isPaused`, `pauseSite`, `unpauseSite` from `src/settings.js` (already imported); icon PNGs from Task 4.
- Produces:
  - `renderToggles(container, settings, { disabled = false } = {})` — third parameter added; existing two-argument calls keep working.
  - `applyPausedState(doc, host, paused)` → void. Moves the single `#pause` button into the banner and relabels it.

- [ ] **Step 1: Add the failing tests**

First widen the existing import at the top of `test/popup.test.js` to pull in the new function:

```js
import { TOGGLE_GROUPS, renderToggles, markUnenforced, applyPausedState } from '../popup/popup.js';
```

Then append:

```js
describe('renderToggles disabled flag', () => {
  it('leaves toggles interactive by default', () => {
    const el = document.createElement('div');
    renderToggles(el, { cookieBanners: true });
    expect(el.querySelector('#toggle-cookieBanners').disabled).toBe(false);
  });

  it('disables every toggle when asked', () => {
    // Dimming alone tells a sighted user; the disabled attribute is what
    // tells assistive technology the same thing.
    const el = document.createElement('div');
    renderToggles(el, { cookieBanners: true }, { disabled: true });
    for (const input of el.querySelectorAll('input')) {
      expect(input.disabled).toBe(true);
    }
  });
});

describe('applyPausedState', () => {
  const mount = () => {
    document.body.innerHTML =
      '<h1></h1><div id="status"></div><div id="toggles"></div>' +
      '<p id="errors"></p><button id="pause"></button>';
    return document;
  };

  it('labels the button to pause when the site is running', () => {
    const doc = mount();
    applyPausedState(doc, 'example.com', false);
    expect(doc.querySelector('#pause').textContent).toBe('Pause on example.com');
    expect(doc.querySelector('#status').textContent).toBe('');
  });

  it('labels the button to resume and promotes it when paused', () => {
    const doc = mount();
    applyPausedState(doc, 'example.com', true);
    const btn = doc.querySelector('#pause');
    expect(btn.textContent).toBe('Resume on example.com');
    expect(btn.classList.contains('primary')).toBe(true);
  });

  it('moves the button into the banner so it sits above the toggles', () => {
    const doc = mount();
    applyPausedState(doc, 'example.com', true);
    expect(doc.querySelector('#status').contains(doc.querySelector('#pause'))).toBe(true);
  });

  it('names the host and explains what pause covers', () => {
    const doc = mount();
    applyPausedState(doc, 'example.com', true);
    const text = doc.querySelector('#status').textContent;
    expect(text).toContain('Paused on example.com');
    expect(text).toContain(
      'Nothing is being blocked here. Cookie banners, prompts, and trackers all behave as the site intends.'
    );
  });

  it('shows the paused icon in the banner', () => {
    const doc = mount();
    applyPausedState(doc, 'example.com', true);
    expect(doc.querySelector('#status img').getAttribute('src')).toBe('../icons/paused-48.png');
  });

  it('clears a previous banner when called again for a running site', () => {
    const doc = mount();
    applyPausedState(doc, 'example.com', true);
    applyPausedState(doc, 'example.com', false);
    expect(doc.querySelector('#status').textContent).toBe('');
    expect(doc.querySelector('#status').querySelector('#pause')).toBe(null);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run test/popup.test.js`
Expected: FAIL — `applyPausedState is not a function`.

- [ ] **Step 3: Update the popup markup**

Replace the whole of `popup/popup.html` with:

```html
<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="popup.css">
<h1><img src="../icons/active-16.png" width="16" height="16" alt=""> Leave Me Alone</h1>
<div id="status"></div>
<div id="toggles"></div>
<p id="errors" class="errors"></p>
<button id="pause"></button>
<script type="module" src="popup.js"></script>
```

The button stays last in the markup and is *moved* into `#status` when paused, so there is only ever one button and one click handler.

- [ ] **Step 4: Add the styles**

Append to `popup/popup.css`:

```css
h1 img {
  vertical-align: -2px;
  margin-right: 0.15rem;
}

.banner {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.55rem;
  align-items: start;
  background: #f1f1f4;
  border: 1px solid #ddd;
  border-radius: 6px;
  padding: 0.55rem 0.6rem;
  margin-bottom: 0.6rem;
}

.banner-title {
  font-weight: 700;
}

.banner-detail {
  color: #5f6368;
  font-size: 0.75rem;
  margin-top: 2px;
  line-height: 1.45;
}

/* Equal breathing room above and below, so Resume reads as its own band
   rather than leaning against the toggle list. */
#pause.primary {
  background: #5b60d6;
  border: 1px solid #5b60d6;
  color: #fff;
  font-weight: 600;
  border-radius: 4px;
  margin-bottom: 0.75rem;
}

.paused-toggles {
  opacity: .42;
}
```

- [ ] **Step 5: Update the popup script**

In `popup/popup.js`, replace `renderToggles`'s signature line and the input creation so it honours the flag. Change:

```js
export function renderToggles(container, settings) {
```

to:

```js
export function renderToggles(container, settings, { disabled = false } = {}) {
```

and immediately after `input.checked = Boolean(settings[t.key]);` add:

```js
      input.disabled = disabled;
```

Then add this exported function directly below `renderToggles`:

```js
/**
 * Paints the paused banner and positions the single pause/resume button.
 * Kept separate from init() so it can be tested without stubbing chrome.tabs.
 */
export function applyPausedState(doc, host, paused) {
  const btn = doc.querySelector('#pause');
  const status = doc.querySelector('#status');
  status.textContent = '';
  btn.textContent = paused ? `Resume on ${host}` : `Pause on ${host}`;
  btn.classList.toggle('primary', paused);
  if (!paused) return;

  const banner = doc.createElement('div');
  banner.className = 'banner';

  const icon = doc.createElement('img');
  icon.src = '../icons/paused-48.png';
  icon.width = 26;
  icon.height = 26;
  icon.alt = '';

  const text = doc.createElement('div');
  const title = doc.createElement('div');
  title.className = 'banner-title';
  title.textContent = `Paused on ${host}`;
  const detail = doc.createElement('div');
  detail.className = 'banner-detail';
  detail.textContent =
    'Nothing is being blocked here. Cookie banners, prompts, and trackers all behave as the site intends.';
  text.append(title, detail);

  banner.append(icon, text);
  status.append(banner, btn);
}
```

Finally, rewrite `init()` so it drives both pieces:

```js
async function init() {
  const settings = await getSettings();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const host = tab?.url ? new URL(tab.url).hostname : null;
  const paused = host ? isPaused(settings, host) : false;

  const container = document.querySelector('#toggles');
  renderToggles(container, settings, { disabled: paused });
  container.classList.toggle('paused-toggles', paused);

  const btn = document.querySelector('#pause');
  if (!host) { btn.hidden = true; return; }

  applyPausedState(document, host, paused);
  btn.addEventListener('click', async () => {
    await (paused ? unpauseSite(host) : pauseSite(host));
    window.close();
  });

  const { lastApplyErrors = [] } = await chrome.storage.local.get({ lastApplyErrors: [] });
  markUnenforced(document, lastApplyErrors);
}
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npx vitest run test/popup.test.js`
Expected: PASS, 14 tests.

- [ ] **Step 7: Run the full suite and build**

Run: `npm test && npm run build`
Expected: PASS, then `built dist/`.

- [ ] **Step 8: Commit**

```bash
git add popup/popup.html popup/popup.css popup/popup.js test/popup.test.js
git commit -m "Show paused state in the popup"
```

---

### Task 7: Documentation

**Files:**
- Modify: `docs/KNOWN-ISSUES.md`
- Modify: `docs/QA.md`
- Modify: `README.md`

- [ ] **Step 1: Replace the resolved known issue**

In `docs/KNOWN-ISSUES.md`, the entry beginning **"Pause only covers the DOM layer."** is now wrong — delete it and put these three in its place:

```markdown
**Pause writes `ask`, which is not the user's own preference.** Pausing a site
writes per-origin content-setting exceptions of `ask` (`allow` for `popups`,
`sound` and `cookies`, which Chrome refuses `ask` for). Extension-set content
settings sit above the user's own layer, so someone who had deliberately
allowed notifications for a site and then pauses it gets `ask`, not their
original grant. This is a real improvement on the previous behaviour, where
extension settings overrode user grants with no route back at all — the site
can prompt again and the user can re-grant — but it is not a true restore, and
no API offers one.

**Toolbar signalling is invisible when the extension is unpinned.** An
extension living in the puzzle-piece overflow menu shows neither its icon
state nor a badge. The popup's paused banner is the only signal those users
get.

**Content-setting reconciliation is O(types x paused sites).** Every settings
change clears and rewrites all eight content-setting types, plus four patterns
per paused domain per type. Fine for a normal paused list; it would need
batching if that list grew into the hundreds.
```

- [ ] **Step 2: Note the widened pause in the same file**

The entry beginning **"`stripWww` is not a public-suffix list."** now has wider reach. Append this sentence to it:

```markdown
This now governs the `declarativeNetRequest` domain exclusions and the
content-setting patterns as well, not just DOM-layer pause.
```

- [ ] **Step 3: Extend the QA checklist**

In `docs/QA.md`, replace the body of **Section 7: Pause and Resume Functionality** with:

```markdown
### Item 9: Pause suspends every layer; resume restores it

- [ ] **Test:** On a site with a consent banner, click pause, then reload.
      **Expect:** the banner appears and stays.
- [ ] **Test:** With pause still on, open DevTools and check a request's
      headers. **Expect:** no `Sec-GPC` header.
- [ ] **Test:** Run `navigator.globalPrivacyControl` in the console.
      **Expect:** `undefined`, not `true`.
- [ ] **Test:** With "Block notification prompts" on globally, visit a paused
      site that requests notifications. **Expect:** Chrome's own permission
      prompt appears rather than a silent block.
- [ ] **Test:** Check `chrome://settings/content/notifications`.
      **Expect:** an entry for the paused domain, set to Ask.
- [ ] **Test:** Resume the site and reload. **Expect:** the banner is
      dismissed again, `Sec-GPC` returns, and the per-domain content-setting
      entry is gone.
- [ ] **Test:** Pause `example.com`, then visit `sub.example.com`.
      **Expect:** paused there too.

### Item 10: Icon and tooltip track the active tab

- [ ] **Test:** Pin the extension. Open a normal site and a paused site in two
      tabs and switch between them. **Expect:** the icon changes to the tilted
      bar on the paused tab and back, without a reload.
- [ ] **Test:** Hover the icon on a paused tab. **Expect:**
      "Leave Me Alone — paused on <host>".
- [ ] **Test:** Open a `chrome://` page. **Expect:** the active icon, no error
      in the service worker console.
- [ ] **Test:** Check the icon against both a light and a dark Chrome theme.
      **Expect:** both tints stay legible at 16px. This is the single-palette
      compromise — MV3 gives no toolbar-theme signal.
- [ ] **Test:** Pause a site, then quit and reopen Chrome. **Expect:** the
      paused icon is restored on that tab.

### Item 11: Popup reflects paused state

- [ ] **Test:** Open the popup on a paused site. **Expect:** a banner naming
      the host, the explanatory sentence, a primary Resume button, and dimmed
      toggles that cannot be clicked.
- [ ] **Test:** Open the popup on a normal site. **Expect:** no banner,
      interactive toggles, and "Pause on <host>" at the bottom.
```

- [ ] **Step 4: Update the README test count**

`README.md` states "all 135 unit tests pass". Run `npm test`, read the actual total from the output, and replace the number. Do not guess it.

- [ ] **Step 5: Verify and commit**

Run: `npm test`
Expected: PASS, with the total matching what you wrote into the README.

```bash
git add docs/KNOWN-ISSUES.md docs/QA.md README.md
git commit -m "Document widened pause and its remaining limits"
```

---

## Verification

After all seven tasks:

```bash
npm test && npm run build
```

Then load `dist/` unpacked via `chrome://extensions` and work through Sections 7's Items 9–11 in `docs/QA.md`. The `chrome.contentSettings` behaviour and the real-toolbar icon rendering cannot be verified headlessly — those checks are the point of the manual pass.
