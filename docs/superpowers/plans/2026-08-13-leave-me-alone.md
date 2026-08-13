# leave-me-alone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Manifest V3 Chrome extension that globally enforces necessary-only cookies, blocked notification and location prompts, and dismissed newsletter popups, from one panel of switches.

**Architecture:** Three strictly separated enforcement layers. Chrome-native preferences go through `chrome.contentSettings`, network-level signals through static `declarativeNetRequest` rulesets, and DOM-level annoyances through a content script. The content script hosts a reimplementation of Consent-O-Matic's rule DSL that reads their MIT-licensed rule bundle, vendored at build time. Every toggle maps to exactly one layer.

**Tech Stack:** Plain JavaScript (ES modules), esbuild for bundling, vitest + jsdom for tests, Node for the rule-bundle build script. No TypeScript — the rule DSL is dynamic data that would be largely `any`, and skipping the typecheck step keeps the build to one command. No runtime dependencies.

## Global Constraints

- **Manifest V3 only.** No background pages, no remotely-hosted code.
- **Zero network requests at runtime.** The extension never fetches anything. Rules are bundled at build time. This is a product promise stated in the README, not an implementation detail.
- **The extension must never break a page.** Every content-script action is individually try/caught with a timeout. On any uncertainty, do nothing.
- **All consent categories are always rejected.** `A`, `B`, `D`, `E`, `F`, `X` all resolve to `false`. Necessary cookies are not a category in this model — CMPs never offer them as togglable — so there is nothing to preserve. This matches Consent-O-Matic's own `GDPRConfig.defaultValues`.
- **Attribution required.** Consent-O-Matic is MIT. Its copyright notice must appear in `THIRD_PARTY.md` and the store listing.
- **Node 20+**, ES module syntax throughout (`"type": "module"` in package.json).

---

## File Structure

```
manifest.json              MV3 manifest
package.json               scripts: build, test, bundle-rules
build.config.mjs           entry groups: iife for content scripts, esm for the rest
build.mjs                  esbuild bundling
scripts/bundle-rules.mjs   fetch + merge Consent-O-Matic rules -> src/rules/bundle.json

src/settings.js            defaults, get/set, per-site pause. Single source of truth.
src/background/index.js    service worker entry; reacts to settings changes
src/background/content-settings.js   chrome.contentSettings layer
src/background/rulesets.js           DNR ruleset enable/disable

src/rules/bundle.json      vendored, generated, ~454 KB
rules/gpc.json             DNR: Sec-GPC header
rules/one-tap.json         DNR: Google one-tap iframe
rules/chat-widgets.json    DNR: Intercom/Drift/Zendesk

src/engine/tools.js        isShown, matchesText, waitForSelector, sleep
src/engine/matchers.js     css, checkbox, onoff, url
src/engine/actions.js      12 action types
src/engine/cmp.js          CMP: detectors + ordered methods
src/engine/index.js        runEngine: pick matching CMP, run it

src/content/index.js       entry: observer loop, dispatch, circuit breaker
src/content/cosmetic.js    cookie-banner fallback hide
src/content/newsletter.js  conservative newsletter heuristic
src/content/scroll.js      restore scroll after any dismissal

popup/popup.html|js|css    the toggle panel

test/fixtures/*.html       real CMP banner snapshots
test/*.test.js
```

**Boundary rules.** `src/engine/` knows nothing about Chrome APIs or about newsletters — it takes a rule bundle and a DOM and returns what it did, which is what makes it testable under jsdom. `src/content/` owns all page-lifecycle concerns. `src/background/` is the only place `chrome.contentSettings` and `chrome.declarativeNetRequest` are touched.

## TDD Convention

Every task follows: write failing test → run it, confirm it fails for the right reason → minimal implementation → run, confirm pass → commit. Where a task lists code, that code is the actual content, not a sketch. Run a single test file with `npx vitest run test/<name>.test.js`.

---

### Task 1: Scaffold, manifest, and build

**Files:**
- Create: `package.json`, `build.mjs`, `manifest.json`, `.gitignore`, `THIRD_PARTY.md`
- Test: `test/smoke.test.js`

**Interfaces:**
- Produces: `npm test`, `npm run build` (writes `dist/`), `npm run bundle-rules`.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/smoke.test.js`
Expected: FAIL — `ENOENT: no such file or directory, open 'manifest.json'`

- [ ] **Step 3: Create package.json**

```json
{
  "name": "leave-me-alone",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "build": "node build.mjs",
    "test": "vitest run",
    "bundle-rules": "node scripts/bundle-rules.mjs"
  },
  "devDependencies": {
    "esbuild": "^0.23.0",
    "jsdom": "^24.0.0",
    "vitest": "^2.0.0"
  }
}
```

Then `npm install`.

- [ ] **Step 4: Create manifest.json**

```json
{
  "manifest_version": 3,
  "name": "Leave Me Alone",
  "version": "0.1.0",
  "description": "Necessary cookies only, no notification prompts, no location requests, no newsletter popups.",
  "permissions": ["storage", "contentSettings", "declarativeNetRequest"],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "background.js", "type": "module" },
  "action": { "default_popup": "popup/popup.html" },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content.js"],
    "run_at": "document_idle",
    "all_frames": true
  }],
  "declarative_net_request": {
    "rule_resources": [
      { "id": "gpc", "enabled": false, "path": "rules/gpc.json" },
      { "id": "one-tap", "enabled": false, "path": "rules/one-tap.json" },
      { "id": "chat-widgets", "enabled": false, "path": "rules/chat-widgets.json" }
    ]
  }
}
```

- [ ] **Step 5: Create build.config.mjs**

The output format is not uniform, and getting it wrong fails silently in the browser while every unit test still passes. Content scripts are injected as **classic scripts** — MV3 has no `"type": "module"` for `content_scripts` entries — so a top-level `export` in those bundles is a `SyntaxError` that kills the whole file. The service worker (`"type": "module"`) and the popup (`<script type="module">`) both load ESM natively.

Keeping the two groups in their own file lets a test assert the formats never drift.

```js
// build.config.mjs
export const SHARED = {
  bundle: true,
  target: 'chrome120',
  outdir: 'dist',
  loader: { '.json': 'json' },
};

// Injected into pages as classic scripts. MUST be iife — a top-level
// `export` here is a SyntaxError that silently disables the whole script.
export const CONTENT_BUILD = {
  ...SHARED,
  format: 'iife',
  entryPoints: {
    content: 'src/content/index.js',
    'gpc-inject': 'src/content/gpc-inject.js',
    'gpc-main': 'src/content/gpc-main.js',
  },
};

// Loaded as real modules by Chrome; ESM is correct here.
export const MODULE_BUILD = {
  ...SHARED,
  format: 'esm',
  entryPoints: {
    background: 'src/background/index.js',
    'popup/popup': 'popup/popup.js',
  },
};
```

Create `build.mjs`:

```js
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';
import { CONTENT_BUILD, MODULE_BUILD } from './build.config.mjs';

mkdirSync('dist', { recursive: true });

await esbuild.build(CONTENT_BUILD);
await esbuild.build(MODULE_BUILD);

for (const f of ['manifest.json', 'rules', 'popup/popup.html', 'popup/popup.css']) {
  cpSync(f, `dist/${f}`, { recursive: true });
}
console.log('built dist/');
```

Note: the `content`, `gpc-inject`, `gpc-main`, and `popup/popup` entries name files that Tasks 4, 5, and 13 create. `npm run build` will not succeed until Task 13. That is expected — do not create stubs.

- [ ] **Step 6: Create .gitignore and THIRD_PARTY.md**

```
# .gitignore
node_modules/
dist/
*.zip
```

`THIRD_PARTY.md` contains the verbatim MIT license text from `https://github.com/cavi-au/Consent-O-Matic/blob/master/LICENSE`, under a heading naming Consent-O-Matic and linking the repo.

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run test/smoke.test.js`
Expected: PASS (4 tests)

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json build.mjs manifest.json .gitignore THIRD_PARTY.md test/smoke.test.js
git commit -m "feat: scaffold MV3 extension with esbuild and vitest"
```

---

### Task 2: Settings store

**Files:**
- Create: `src/settings.js`
- Test: `test/settings.test.js`

**Interfaces:**
- Produces: `DEFAULTS`, `getSettings()`, `setSetting(key, value)`, `isPaused(settings, hostname)`, `pauseSite(hostname)`, `unpauseSite(hostname)`. All async except `isPaused` and `DEFAULTS`.

- [ ] **Step 1: Write the failing test**

```js
// test/settings.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/settings.test.js`
Expected: FAIL — cannot resolve `../src/settings.js`

- [ ] **Step 3: Implement src/settings.js**

```js
export const DEFAULTS = {
  // primary
  cookieBanners: true,
  notifications: true,
  location: true,
  newsletters: true,
  // more, on by default
  gpc: true,
  cameraMic: true,
  popupsDownloads: true,
  autoplaySound: true,
  // more, off by default
  chatWidgets: false,
  googleOneTap: false,
  sessionOnlyCookies: false,
};

const SHAPE = { ...DEFAULTS, pausedSites: [] };

export async function getSettings() {
  return chrome.storage.sync.get(SHAPE);
}

export async function setSetting(key, value) {
  await chrome.storage.sync.set({ [key]: value });
}

export function isPaused(settings, hostname) {
  const host = String(hostname).toLowerCase();
  return (settings.pausedSites ?? []).some(
    (d) => host === d || host.endsWith(`.${d}`)
  );
}

export async function pauseSite(hostname) {
  const { pausedSites = [] } = await chrome.storage.sync.get({ pausedSites: [] });
  const d = String(hostname).toLowerCase();
  if (!pausedSites.includes(d)) {
    await chrome.storage.sync.set({ pausedSites: [...pausedSites, d] });
  }
}

export async function unpauseSite(hostname) {
  const { pausedSites = [] } = await chrome.storage.sync.get({ pausedSites: [] });
  const d = String(hostname).toLowerCase();
  await chrome.storage.sync.set({ pausedSites: pausedSites.filter((x) => x !== d) });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/settings.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/settings.js test/settings.test.js
git commit -m "feat: settings store with per-site pause"
```

---

### Task 3: contentSettings layer

**Files:**
- Create: `src/background/content-settings.js`
- Test: `test/content-settings.test.js`

**Interfaces:**
- Consumes: `DEFAULTS` from `src/settings.js`.
- Produces: `applyContentSettings(settings)` → `Promise<{ ok: string[], failed: Array<{type, settingKey, error}> }>`.

The failure report matters: a toggle that shows as on but is not enforced is worse than one that admits it failed. Task 5 surfaces this in the popup.

Each `failed` entry carries **both** identifiers. `type` is the Chrome content-settings type that rejected (`camera`); `settingKey` is the user-facing toggle that drove it (`cameraMic`). One toggle can drive two types, so type alone cannot tell the popup which switch to mark — and marking the switch is what the design doc requires.

- [ ] **Step 1: Write the failing test**

```js
// test/content-settings.test.js
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
    // microphone still applied — one failure must not abort its partner
    expect(calls).toContainEqual(['microphone', 'block']);
  });

  it('keeps applying later map entries after an earlier one fails', async () => {
    chrome.contentSettings.notifications.set = async () => { throw new Error('x'); };
    const r = await applyContentSettings({ notifications: true, sessionOnlyCookies: true });
    expect(r.failed).toHaveLength(1);
    expect(calls).toContainEqual(['cookies', 'session_only']);
  });

  it('survives a rejection that is not an Error', async () => {
    chrome.contentSettings.sound.set = async () => { throw 'plain string'; };
    const r = await applyContentSettings({ autoplaySound: true });
    expect(r.failed[0].error).toBe('plain string');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/content-settings.test.js`
Expected: FAIL — cannot resolve module

- [ ] **Step 3: Implement src/background/content-settings.js**

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

export async function applyContentSettings(settings) {
  const ok = [];
  const failed = [];

  for (const { key, types, blocked } of MAP) {
    const setting = settings[key] ? blocked : 'allow';
    for (const type of types) {
      try {
        await chrome.contentSettings[type].set({
          primaryPattern: '<all_urls>',
          setting,
        });
        ok.push(type);
      } catch (e) {
        // `sound` requires Chrome 141+; older builds reject it. Report, don't throw.
        // Carry settingKey too: one toggle can drive two types, and the popup
        // marks the toggle, not the type.
        failed.push({
          type,
          settingKey: key,
          error: e?.message ?? String(e),
        });
      }
    }
  }
  return { ok, failed };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/content-settings.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/background/content-settings.js test/content-settings.test.js
git commit -m "feat: contentSettings enforcement layer"
```

---

### Task 4: DNR rulesets, GPC property, and service worker

**Files:**
- Create: `rules/gpc.json`, `rules/one-tap.json`, `rules/chat-widgets.json`, `src/background/rulesets.js`, `src/background/index.js`, `src/content/gpc-inject.js`, `src/content/gpc-main.js`
- Modify: `manifest.json` (add the GPC injector content script and `web_accessible_resources`)
- Test: `test/rulesets.test.js`, `test/gpc.test.js`

**Interfaces:**
- Consumes: `getSettings` from `src/settings.js`, `applyContentSettings` from Task 3.
- Produces: `RULESET_MAP`, `applyRulesets(settings)`, `injectGpc(doc, settings)`.

**Why two GPC mechanisms.** The spec requires both the `Sec-GPC` request header and the `navigator.globalPrivacyControl` property — some sites check one, some the other. The header is a DNR rule. The property must be set in the page's MAIN world, which an ISOLATED content script cannot reach directly, so `gpc-inject.js` (ISOLATED, `document_start`) reads the toggle and appends a `<script src=…gpc-main.js>` from `web_accessible_resources`. This needs no `scripting` permission.

**Known caveat, accept it.** Reading `chrome.storage` is async, so the property is set a few milliseconds into page load rather than truly synchronously. Page scripts that read `navigator.globalPrivacyControl` in their very first statement may miss it. Do not try to close this race — the alternatives are a `scripting` permission or an ungated always-on injection, both of which the plan rejected deliberately.

- [ ] **Step 1: Write the failing test**

```js
// test/rulesets.test.js
import { readFileSync } from 'node:fs';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { applyRulesets } from '../src/background/rulesets.js';

let update;
beforeEach(() => {
  update = vi.fn(async () => {});
  globalThis.chrome = { declarativeNetRequest: { updateEnabledRulesets: update } };
});

describe('DNR rulesets', () => {
  it('gpc rule sets the Sec-GPC header on every request', () => {
    const r = JSON.parse(readFileSync('rules/gpc.json', 'utf8'))[0];
    expect(r.action.type).toBe('modifyHeaders');
    const h = r.action.requestHeaders[0];
    expect(h).toMatchObject({ header: 'Sec-GPC', operation: 'set', value: '1' });
    expect(r.condition.urlFilter).toBe('*');
  });

  it('enables and disables rulesets to match settings', async () => {
    await applyRulesets({ gpc: true, googleOneTap: false, chatWidgets: true });
    expect(update).toHaveBeenCalledWith({
      enableRulesetIds: ['gpc', 'chat-widgets'],
      disableRulesetIds: ['one-tap'],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/rulesets.test.js`
Expected: FAIL — cannot resolve module

- [ ] **Step 3: Create the three rule files**

```json
// rules/gpc.json
[{
  "id": 1,
  "priority": 1,
  "action": {
    "type": "modifyHeaders",
    "requestHeaders": [{ "header": "Sec-GPC", "operation": "set", "value": "1" }]
  },
  "condition": { "urlFilter": "*", "resourceTypes": ["main_frame", "sub_frame", "xmlhttprequest"] }
}]
```

```json
// rules/one-tap.json
[{
  "id": 1,
  "priority": 1,
  "action": { "type": "block" },
  "condition": {
    "urlFilter": "||accounts.google.com/gsi/",
    "resourceTypes": ["sub_frame", "script"]
  }
}]
```

```json
// rules/chat-widgets.json
[{
  "id": 1, "priority": 1, "action": { "type": "block" },
  "condition": {
    "requestDomains": ["widget.intercom.io", "js.driftt.com", "static.zdassets.com", "widget-mediator.zopim.com"],
    "resourceTypes": ["script", "xmlhttprequest", "sub_frame"]
  }
}]
```

- [ ] **Step 4: Implement src/background/rulesets.js**

```js
export const RULESET_MAP = {
  gpc: 'gpc',
  googleOneTap: 'one-tap',
  chatWidgets: 'chat-widgets',
};

export async function applyRulesets(settings) {
  const enableRulesetIds = [];
  const disableRulesetIds = [];
  for (const [key, id] of Object.entries(RULESET_MAP)) {
    (settings[key] ? enableRulesetIds : disableRulesetIds).push(id);
  }
  await chrome.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds,
    disableRulesetIds,
  });
}
```

- [ ] **Step 5: Implement src/background/index.js**

```js
import { getSettings } from '../settings.js';
import { applyContentSettings } from './content-settings.js';
import { applyRulesets } from './rulesets.js';

async function applyAll() {
  const settings = await getSettings();
  const [cs] = await Promise.all([
    applyContentSettings(settings),
    applyRulesets(settings),
  ]);
  // Surfaced by the popup so a toggle can never claim enforcement it didn't get.
  await chrome.storage.local.set({ lastApplyErrors: cs.failed });
}

chrome.runtime.onInstalled.addListener(applyAll);
chrome.runtime.onStartup.addListener(applyAll);
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'sync') applyAll();
});
```

- [ ] **Step 6: Write the failing GPC injection test**

```js
// test/gpc.test.js
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
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run test/gpc.test.js`
Expected: FAIL — cannot resolve `../src/content/gpc-inject.js`

- [ ] **Step 8: Implement the two GPC scripts**

```js
// src/content/gpc-inject.js — ISOLATED world, document_start
import { getSettings } from '../settings.js';

const MARKER = 'data-lma-gpc';

export function injectGpc(doc, settings) {
  if (!settings?.gpc) return null;
  if (doc.querySelector(`script[${MARKER}]`)) return null;

  const el = doc.createElement('script');
  el.setAttribute(MARKER, '');
  el.src = chrome.runtime.getURL('gpc-main.js');
  // Remove the tag once it has run; the property it sets persists.
  el.onload = () => el.remove();
  (doc.head ?? doc.documentElement).appendChild(el);
  return el;
}

async function main() {
  injectGpc(document, await getSettings());
}

if (typeof chrome !== 'undefined' && chrome.storage) main();
```

```js
// src/content/gpc-main.js — runs in the page's MAIN world
// Standalone by design: bundled as its own entry, no imports.
try {
  Object.defineProperty(navigator, 'globalPrivacyControl', {
    value: true,
    configurable: false,
    enumerable: true,
  });
} catch {
  // Another extension may have defined it already. Theirs is equivalent; leave it.
}
```

Both GPC entry points are already declared in `build.config.mjs`'s `CONTENT_BUILD` from Task 1, so no build change is needed here — verify they are present and in the `iife` group, not the `esm` one.

Add to `manifest.json`:

```json
"content_scripts": [
  { "matches": ["<all_urls>"], "js": ["content.js"], "run_at": "document_idle", "all_frames": true },
  { "matches": ["<all_urls>"], "js": ["gpc-inject.js"], "run_at": "document_start", "all_frames": true }
],
"web_accessible_resources": [
  { "resources": ["gpc-main.js"], "matches": ["<all_urls>"] }
]
```

- [ ] **Step 9: Write the bundle-format guard test**

This is the test that would have caught the format bug. It builds the real content-script config and asserts the output is loadable as a classic script.

```js
// test/bundle-format.test.js
import * as esbuild from 'esbuild';
import { describe, it, expect } from 'vitest';
import { CONTENT_BUILD, MODULE_BUILD } from '../build.config.mjs';

describe('bundle formats', () => {
  it('builds content scripts as iife, never esm', () => {
    expect(CONTENT_BUILD.format).toBe('iife');
    expect(MODULE_BUILD.format).toBe('esm');
  });

  it('emits no top-level export in a content-script bundle', async () => {
    // MV3 content_scripts have no "type": "module" — a top-level export
    // is a SyntaxError that silently disables the entire script.
    const r = await esbuild.build({
      ...CONTENT_BUILD,
      entryPoints: ['src/content/gpc-inject.js'],
      outdir: undefined,
      write: false,
    });
    expect(r.outputFiles[0].text).not.toMatch(/^export[\s{]/m);
  });
});
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `npx vitest run test/rulesets.test.js test/gpc.test.js test/bundle-format.test.js`
Expected: PASS (2 + 3 + 2 tests)

- [ ] **Step 11: Commit**

```bash
git add rules/ src/background/ src/content/gpc-inject.js src/content/gpc-main.js \
        manifest.json build.config.mjs build.mjs \
        test/rulesets.test.js test/gpc.test.js test/bundle-format.test.js
git commit -m "feat: DNR rulesets and GPC signal via header and navigator property"
```

---

### Task 5: Popup UI

**Files:**
- Create: `popup/popup.html`, `popup/popup.js`, `popup/popup.css`
- Test: `test/popup.test.js`

**Interfaces:**
- Consumes: `DEFAULTS`, `getSettings`, `setSetting`, `pauseSite`, `unpauseSite`, `isPaused`.
- Produces: `renderToggles(container, settings)`, `TOGGLE_GROUPS`.

- [ ] **Step 1: Write the failing test**

```js
// test/popup.test.js
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { TOGGLE_GROUPS, renderToggles } from '../popup/popup.js';

describe('popup', () => {
  it('puts exactly the four complaint toggles in the primary group', () => {
    expect(TOGGLE_GROUPS.primary.map((t) => t.key))
      .toEqual(['cookieBanners', 'notifications', 'location', 'newsletters']);
  });

  it('warns on the session-cookie toggle', () => {
    const t = TOGGLE_GROUPS.more.find((t) => t.key === 'sessionOnlyCookies');
    expect(t.warning).toMatch(/log(ged)? out/i);
  });

  it('renders a checkbox per toggle reflecting current state', () => {
    const el = document.createElement('div');
    renderToggles(el, { cookieBanners: true, notifications: false });
    expect(el.querySelector('#toggle-cookieBanners').checked).toBe(true);
    expect(el.querySelector('#toggle-notifications').checked).toBe(false);
  });
});

describe('markUnenforced', () => {
  const mount = () => {
    document.body.innerHTML = '<div id="toggles"></div><p id="errors"></p>';
    renderToggles(document.querySelector('#toggles'), {});
    return document;
  };

  it('collapses two failures from one toggle into a single label', () => {
    const doc = mount();
    // cameraMic drives both camera and microphone; the user has one switch.
    markUnenforced(doc, [
      { type: 'camera', settingKey: 'cameraMic', error: 'x' },
      { type: 'microphone', settingKey: 'cameraMic', error: 'x' },
    ]);
    const text = doc.querySelector('#errors').textContent;
    expect(text).toContain('Block camera & microphone prompts');
    expect(text.match(/camera/gi)).toHaveLength(1);
  });

  it('marks the row of the toggle that failed', () => {
    const doc = mount();
    markUnenforced(doc, [{ type: 'sound', settingKey: 'autoplaySound', error: 'x' }]);
    const row = doc.querySelector('#toggle-autoplaySound').closest('.row');
    expect(row.classList.contains('unenforced')).toBe(true);
    expect(doc.querySelector('#toggle-notifications').closest('.row')
      .classList.contains('unenforced')).toBe(false);
  });

  it('says nothing when everything applied', () => {
    const doc = mount();
    markUnenforced(doc, []);
    expect(doc.querySelector('#errors').textContent).toBe('');
    expect(doc.querySelectorAll('.unenforced')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/popup.test.js`
Expected: FAIL — cannot resolve `../popup/popup.js`

- [ ] **Step 3: Implement popup/popup.js**

```js
import { getSettings, setSetting, pauseSite, unpauseSite, isPaused } from '../src/settings.js';

export const TOGGLE_GROUPS = {
  primary: [
    { key: 'cookieBanners', label: 'Reject cookie banners' },
    { key: 'notifications', label: 'Block notification prompts' },
    { key: 'location',      label: 'Block location requests' },
    { key: 'newsletters',   label: 'Dismiss newsletter popups' },
  ],
  more: [
    { key: 'gpc',             label: 'Send Global Privacy Control' },
    { key: 'cameraMic',       label: 'Block camera & microphone prompts' },
    { key: 'popupsDownloads', label: 'Block popups & automatic downloads' },
    { key: 'autoplaySound',   label: 'Block autoplaying sound' },
    { key: 'chatWidgets',     label: 'Hide chat bubbles' },
    { key: 'googleOneTap',    label: 'Block Google one-tap sign-in' },
    { key: 'sessionOnlyCookies', label: 'Delete all cookies on quit',
      warning: 'You will be logged out of every site each time you close Chrome.' },
  ],
};

export function renderToggles(container, settings) {
  container.textContent = '';
  for (const [group, toggles] of Object.entries(TOGGLE_GROUPS)) {
    const section = document.createElement('section');
    section.className = group;
    for (const t of toggles) {
      const row = document.createElement('label');
      row.className = 'row';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = `toggle-${t.key}`;
      input.checked = Boolean(settings[t.key]);
      input.addEventListener('change', () => setSetting(t.key, input.checked));

      const span = document.createElement('span');
      span.textContent = t.label;

      row.append(input, span);
      if (t.warning) {
        const w = document.createElement('small');
        w.className = 'warning';
        w.textContent = t.warning;
        row.append(w);
      }
      section.append(row);
    }
    container.append(section);
  }
}

async function init() {
  const settings = await getSettings();
  renderToggles(document.querySelector('#toggles'), settings);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const host = tab?.url ? new URL(tab.url).hostname : null;
  const btn = document.querySelector('#pause');
  if (!host) { btn.hidden = true; return; }

  const paused = isPaused(settings, host);
  btn.textContent = paused ? `Resume on ${host}` : `Pause on ${host}`;
  btn.addEventListener('click', async () => {
    await (paused ? unpauseSite(host) : pauseSite(host));
    window.close();
  });

  const { lastApplyErrors = [] } = await chrome.storage.local.get({ lastApplyErrors: [] });
  markUnenforced(document, lastApplyErrors);
}

/** Marks the toggles Chrome refused to enforce, by their settingKey. */
export function markUnenforced(doc, failures = []) {
  const keys = [...new Set(failures.map((f) => f.settingKey))];
  if (keys.length === 0) return;

  const all = [...TOGGLE_GROUPS.primary, ...TOGGLE_GROUPS.more];
  for (const key of keys) {
    doc.querySelector(`#toggle-${key}`)?.closest('.row')?.classList.add('unenforced');
  }
  const labels = keys.map((k) => all.find((t) => t.key === k)?.label ?? k);
  doc.querySelector('#errors').textContent =
    `This Chrome version can't enforce: ${labels.join(', ')}`;
}

if (typeof document !== 'undefined' && document.querySelector('#toggles')) init();
```

- [ ] **Step 4: Create popup/popup.html**

```html
<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="popup.css">
<h1>Leave Me Alone</h1>
<div id="toggles"></div>
<p id="errors" class="errors"></p>
<button id="pause"></button>
<script type="module" src="popup.js"></script>
```

- [ ] **Step 5: Create popup/popup.css**

Minimal: `width: 300px`, system font stack, `.row { display: grid; grid-template-columns: auto 1fr; gap: .5rem; align-items: center; }`, `.more { border-top: 1px solid #ddd; margin-top: .75rem; padding-top: .75rem; }`, `.warning { grid-column: 2; color: #a33; font-size: .75rem; }`, `.errors:empty { display: none; }`.

Also `.unenforced { opacity: .55; }` — `markUnenforced` adds that class to rows Chrome refused to apply, and without a rule for it the marking is invisible and the class is dead code.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run test/popup.test.js`
Expected: PASS (3 tests)

- [ ] **Step 7: Commit**

```bash
git add popup/ test/popup.test.js
git commit -m "feat: popup with primary and secondary toggle groups"
```

---

### Task 6: Rule bundle build script

**Files:**
- Create: `scripts/bundle-rules.mjs`
- Test: `test/bundle.test.js`

**Interfaces:**
- Produces: `src/rules/bundle.json` — `{ version: <ISO date>, source: <url>, rules: { [cmpName]: ruleBody } }`.

This is the one script that touches the network, and it runs at build time only. Nothing in `src/` may fetch.

- [ ] **Step 1: Write the failing test**

```js
// test/bundle.test.js
import { readFileSync, existsSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const PATH = 'src/rules/bundle.json';

describe('rule bundle', () => {
  it('exists — run `npm run bundle-rules` if this fails', () => {
    expect(existsSync(PATH)).toBe(true);
  });

  const b = JSON.parse(readFileSync(PATH, 'utf8'));

  it('carries provenance', () => {
    expect(b.version).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(b.source).toContain('Consent-O-Matic');
  });

  it('covers the major CMPs', () => {
    for (const n of ['onetrust', 'cookiebot', 'didomi.io', 'quantcast', 'usercentrics']) {
      expect(Object.keys(b.rules).some((k) => k.toLowerCase().includes(n.split('.')[0]))).toBe(true);
    }
  });

  it('has stripped $schema keys', () => {
    expect(JSON.stringify(b.rules)).not.toContain('$schema');
  });

  it('every rule has detectors and methods', () => {
    for (const [name, r] of Object.entries(b.rules)) {
      expect(Array.isArray(r.detectors), `${name} detectors`).toBe(true);
      expect(Array.isArray(r.methods), `${name} methods`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/bundle.test.js`
Expected: FAIL — `src/rules/bundle.json` does not exist

- [ ] **Step 3: Implement scripts/bundle-rules.mjs**

```js
import { mkdirSync, writeFileSync } from 'node:fs';

const LIST = 'https://raw.githubusercontent.com/cavi-au/Consent-O-Matic/master/rules-list.json';
const REPO = 'https://github.com/cavi-au/Consent-O-Matic';

const { references } = await (await fetch(LIST)).json();
console.log(`fetching ${references.length} rule files...`);

const rules = {};
for (const url of references) {
  const res = await fetch(url);
  if (!res.ok) { console.warn(`skip ${url}: ${res.status}`); continue; }
  const body = await res.json();
  delete body.$schema;
  Object.assign(rules, body);
}

mkdirSync('src/rules', { recursive: true });
const bundle = {
  version: new Date().toISOString().slice(0, 10),
  source: `${REPO} (MIT)`,
  rules,
};
writeFileSync('src/rules/bundle.json', JSON.stringify(bundle));
console.log(`bundled ${Object.keys(rules).length} CMPs`);
```

- [ ] **Step 4: Run the script, then the test**

Run: `npm run bundle-rules && npx vitest run test/bundle.test.js`
Expected: `bundled 203 CMPs`, then PASS (5 tests)

- [ ] **Step 5: Commit**

The generated bundle is committed — it is a vendored dependency, and committing it is what makes builds reproducible without network access.

```bash
git add scripts/bundle-rules.mjs src/rules/bundle.json test/bundle.test.js
git commit -m "feat: vendor Consent-O-Matic rule bundle at build time"
```

---

### Task 7: Engine helpers

**Files:**
- Create: `src/engine/tools.js`
- Test: `test/tools.test.js`

**Interfaces:**
- Produces: `isShown(el)`, `matchesText(el, filters)`, `queryAll(root, target)`, `sleep(ms)`, `waitFor(fn, timeoutMs)`.

`queryAll` centralises the `target` shape used everywhere in the DSL: `{ selector, textFilter, displayFilter, iframeFilter, childFilter }`.

- [ ] **Step 1: Write the failing test**

```js
// test/tools.test.js
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { isShown, matchesText, queryAll, waitFor } from '../src/engine/tools.js';

describe('isShown', () => {
  it('is false for display:none', () => {
    document.body.innerHTML = `<div id="a" style="display:none">x</div>`;
    expect(isShown(document.querySelector('#a'))).toBe(false);
  });
  it('is true for a laid-out element', () => {
    document.body.innerHTML = `<div id="a">x</div>`;
    const el = document.querySelector('#a');
    el.getBoundingClientRect = () => ({ width: 100, height: 20 });
    expect(isShown(el)).toBe(true);
  });
});

describe('matchesText', () => {
  it('matches case-insensitively on trimmed text', () => {
    document.body.innerHTML = `<button>  Manage Cookies </button>`;
    expect(matchesText(document.querySelector('button'), ['manage cookies'])).toBe(true);
  });
  it('returns true when no filter is given', () => {
    document.body.innerHTML = `<button>x</button>`;
    expect(matchesText(document.querySelector('button'), undefined)).toBe(true);
  });
});

describe('queryAll', () => {
  it('applies selector and textFilter together', () => {
    document.body.innerHTML = `<a class="b">Accept</a><a class="b">Reject</a>`;
    const r = queryAll(document, { selector: '.b', textFilter: ['reject'] });
    expect(r).toHaveLength(1);
    expect(r[0].textContent).toBe('Reject');
  });
  it('returns [] for a selector that matches nothing', () => {
    document.body.innerHTML = ``;
    expect(queryAll(document, { selector: '.nope' })).toEqual([]);
  });
});

describe('waitFor', () => {
  it('resolves null on timeout rather than throwing', async () => {
    expect(await waitFor(() => null, 30)).toBe(null);
  });
  it('resolves with the value once available', async () => {
    let v = null;
    setTimeout(() => { v = 'ready'; }, 10);
    expect(await waitFor(() => v, 500)).toBe('ready');
  });
  it('treats a throwing predicate as not-ready, never rejecting', async () => {
    expect(await waitFor(() => { throw new Error('boom'); }, 30)).toBe(null);
  });
});

// These are the page-safety guarantees. They are the reason this layer
// exists in the shape it does, so they get explicit tests.
describe('queryAll never throws into the page', () => {
  it('returns [] for a malformed selector', () => {
    document.body.innerHTML = `<div>x</div>`;
    expect(queryAll(document, { selector: '[unclosed' })).toEqual([]);
    expect(queryAll(document, { selector: ':::bad' })).toEqual([]);
  });

  it('returns [] when an element throws during filtering', () => {
    document.body.innerHTML = `<div id="a">x</div>`;
    const el = document.querySelector('#a');
    // Simulates a node whose document lost its browsing context.
    Object.defineProperty(el, 'ownerDocument', {
      get() { throw new Error('detached'); },
    });
    expect(queryAll(document, { selector: '#a', displayFilter: true })).toEqual([]);
  });

  it('applies displayFilter, excluding hidden elements', () => {
    document.body.innerHTML =
      `<div class="c" id="v">shown</div><div class="c" style="display:none">hidden</div>`;
    document.querySelector('#v').getBoundingClientRect = () => ({ width: 10, height: 10 });
    const r = queryAll(document, { selector: '.c', displayFilter: true });
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('v');
  });

  it('applies childFilter, requiring a descendant match', () => {
    document.body.innerHTML =
      `<div class="row" id="has"><input type="checkbox"></div>` +
      `<div class="row" id="lacks"><span>no input</span></div>`;
    const r = queryAll(document, { selector: '.row', childFilter: { selector: 'input' } });
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('has');
  });
});

describe('isShown on a detached document', () => {
  it('is false rather than throwing when defaultView is null', () => {
    document.body.innerHTML = `<div id="a">x</div>`;
    const el = document.querySelector('#a');
    Object.defineProperty(el, 'ownerDocument', { get: () => ({ defaultView: null }) });
    expect(() => isShown(el)).not.toThrow();
    expect(isShown(el)).toBe(false);
  });
});

describe('matchesText with malformed rule data', () => {
  it('accepts a bare string where an array was expected', () => {
    document.body.innerHTML = `<button>Reject all</button>`;
    expect(matchesText(document.querySelector('button'), 'reject')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/tools.test.js`
Expected: FAIL — cannot resolve module

- [ ] **Step 3: Implement src/engine/tools.js**

```js
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function isShown(el) {
  if (!el || !el.isConnected) return false;
  // isConnected stays true for nodes inside a DETACHED iframe's document,
  // but that document's defaultView is null once its browsing context is
  // discarded. Consent UIs live in iframes constantly, so reading
  // ownerDocument.defaultView unguarded throws on a routine case.
  const view = el.ownerDocument?.defaultView;
  if (!view) return false;

  const style = view.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (style.opacity === '0') return false; // computed opacity normalizes to a string
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function matchesText(el, filters) {
  // Vendored rules occasionally carry a bare string where an array belongs.
  const list = Array.isArray(filters) ? filters : filters == null ? [] : [filters];
  if (list.length === 0) return true;
  const text = (el.textContent ?? '').trim().toLowerCase();
  return list.some((f) => text.includes(String(f).trim().toLowerCase()));
}

export function queryAll(root, target) {
  if (!target?.selector) return [];
  try {
    let els = Array.from((root ?? document).querySelectorAll(target.selector));
    if (target.textFilter) els = els.filter((el) => matchesText(el, target.textFilter));
    if (target.displayFilter) els = els.filter((el) => isShown(el));
    if (target.childFilter) {
      els = els.filter((el) => queryAll(el, target.childFilter).length > 0);
    }
    return els;
  } catch {
    // The guard covers the WHOLE pipeline, not just the selector: a detached
    // document, odd rule data, or a hostile getter must never throw into the
    // host page. Returning [] degrades to "found nothing".
    return [];
  }
}

export async function waitFor(fn, timeoutMs = 2000, intervalMs = 50) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let v = null;
    try {
      v = fn();
    } catch {
      v = null; // a throwing predicate is "not ready", never an escaping rejection
    }
    if (v) return v;
    if (Date.now() >= deadline) return null;
    await sleep(intervalMs);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/tools.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/engine/tools.js test/tools.test.js
git commit -m "feat: engine DOM helpers"
```

---

### Task 8: Matchers

**Files:**
- Create: `src/engine/matchers.js`
- Test: `test/matchers.test.js`

**Interfaces:**
- Consumes: `queryAll`, `isShown` from Task 7.
- Produces: `createMatcher(config)` → `{ matches(root) => boolean }`. Types: `css`, `checkbox`, `onoff`, `url`. Unknown types return a matcher that is always `false`.

- [ ] **Step 1: Write the failing test**

```js
// test/matchers.test.js
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createMatcher, matchesAll } from '../src/engine/matchers.js';

describe('createMatcher', () => {
  it('css matches when the selector hits', () => {
    document.body.innerHTML = `<div id="banner">hi</div>`;
    expect(createMatcher({ type: 'css', target: { selector: '#banner' } }).matches(document)).toBe(true);
  });

  it('css does not match when the selector misses', () => {
    document.body.innerHTML = ``;
    expect(createMatcher({ type: 'css', target: { selector: '#banner' } }).matches(document)).toBe(false);
  });

  it('checkbox reports the checked state', () => {
    document.body.innerHTML = `<input type="checkbox" id="c" checked>`;
    const m = createMatcher({ type: 'checkbox', target: { selector: '#c' } });
    expect(m.matches(document)).toBe(true);
    document.querySelector('#c').checked = false;
    expect(m.matches(document)).toBe(false);
  });

  it('onoff reads aria-checked for non-input toggles', () => {
    document.body.innerHTML = `<div id="t" role="switch" aria-checked="true"></div>`;
    const m = createMatcher({ type: 'onoff', target: { selector: '#t' } });
    expect(m.matches(document)).toBe(true);
  });

  it('unknown matcher types are false, never thrown', () => {
    expect(createMatcher({ type: 'nonsense' }).matches(document)).toBe(false);
    expect(createMatcher(null).matches(document)).toBe(false);
    expect(createMatcher({ type: 'css' }).matches(document)).toBe(false); // no target
  });

  it('reads on/off from a data-checked attribute', () => {
    document.body.innerHTML = `<div id="t" data-checked="true"></div>`;
    expect(createMatcher({ type: 'onoff', target: { selector: '#t' } })
      .matches(document)).toBe(true);
    document.querySelector('#t').setAttribute('data-checked', 'false');
    expect(createMatcher({ type: 'onoff', target: { selector: '#t' } })
      .matches(document)).toBe(false);
  });

  it('reads on/off from a class name when nothing else is present', () => {
    document.body.innerHTML = `<div id="on" class="checked"></div><div id="off"></div>`;
    const m = (sel) => createMatcher({ type: 'checkbox', target: { selector: sel } })
      .matches(document);
    expect(m('#on')).toBe(true);
    expect(m('#off')).toBe(false);
  });
});

describe('url matcher', () => {
  it('matches the current href', () => {
    // jsdom's default location is http://localhost:3000/
    expect(createMatcher({ type: 'url', target: { regex: 'localhost' } })
      .matches(document)).toBe(true);
    expect(createMatcher({ type: 'url', target: { regex: 'example\\.com' } })
      .matches(document)).toBe(false);
  });

  it('returns false rather than throwing on a malformed pattern', () => {
    const m = createMatcher({ type: 'url', target: { regex: '[' } });
    expect(() => m.matches(document)).not.toThrow();
    expect(m.matches(document)).toBe(false);
  });

  it('one malformed pattern does not void a valid sibling', () => {
    const m = createMatcher({ type: 'url', target: { urlFilter: ['[', 'localhost'] } });
    expect(m.matches(document)).toBe(true);
  });
});

describe('matchesAll', () => {
  it('is false for an empty list — a detector with no matchers matches nothing', () => {
    expect(matchesAll([], document)).toBe(false);
  });

  it('accepts a single config that is not wrapped in an array', () => {
    document.body.innerHTML = `<div id="b"></div>`;
    expect(matchesAll({ type: 'css', target: { selector: '#b' } }, document)).toBe(true);
  });

  it('requires every config to match', () => {
    document.body.innerHTML = `<div id="a"></div>`;
    const present = { type: 'css', target: { selector: '#a' } };
    const absent = { type: 'css', target: { selector: '#nope' } };
    expect(matchesAll([present, present], document)).toBe(true);
    expect(matchesAll([present, absent], document)).toBe(false);
  });

  it('survives a matcher that throws', () => {
    document.body.innerHTML = `<div id="a"></div>`;
    expect(matchesAll([{ type: 'url', target: { regex: '(' } }], document)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/matchers.test.js`
Expected: FAIL — cannot resolve module

- [ ] **Step 3: Implement src/engine/matchers.js**

```js
import { queryAll } from './tools.js';

const ON_VALUES = new Set(['true', 'on', 'yes', 'checked', '1']);

function readOnOff(el) {
  if (el.matches('input[type=checkbox], input[type=radio]')) return el.checked;
  const aria = el.getAttribute('aria-checked') ?? el.getAttribute('aria-pressed');
  if (aria != null) return ON_VALUES.has(aria.toLowerCase());
  if (el.hasAttribute('data-checked')) {
    return ON_VALUES.has((el.getAttribute('data-checked') || '').toLowerCase());
  }
  return el.classList.contains('checked') || el.classList.contains('active');
}

// checkbox and onoff are the same question asked twice by the DSL.
const readState = (c) => ({
  matches: (root) => {
    const el = queryAll(root, c.target)[0];
    return el ? readOnOff(el) : false;
  },
});

const TYPES = {
  css: (c) => ({ matches: (root) => queryAll(root, c.target).length > 0 }),

  checkbox: readState,
  onoff: readState,

  url: (c) => ({
    matches: () => {
      const filters = c.target?.regex ? [c.target.regex] : (c.target?.urlFilter ?? []);
      const href = globalThis.location?.href ?? '';
      return filters.some((f) => {
        try {
          return new RegExp(f).test(href);
        } catch {
          return false; // one malformed pattern must not void the others
        }
      });
    },
  }),
};

export function createMatcher(config) {
  const make = TYPES[config?.type];
  if (!make) return { matches: () => false };

  let inner;
  try {
    inner = make(config);
  } catch {
    return { matches: () => false };
  }

  // The guard must wrap EVALUATION, not just construction. Every matcher
  // body runs against untrusted rule data at match time — long after
  // createMatcher returned — so guarding only `make(config)` protects
  // nothing: for every type here, make() just returns an object literal.
  return {
    matches(root) {
      try {
        return Boolean(inner.matches(root));
      } catch {
        return false;
      }
    },
  };
}

export function matchesAll(configs, root) {
  const list = Array.isArray(configs) ? configs : [configs];
  return list.length > 0 && list.every((c) => createMatcher(c).matches(root));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/matchers.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/engine/matchers.js test/matchers.test.js
git commit -m "feat: rule DSL matchers"
```

---

### Task 9: Actions

**Files:**
- Create: `src/engine/actions.js`
- Test: `test/actions.test.js`

**Interfaces:**
- Consumes: `queryAll`, `isShown`, `sleep`, `waitFor` (Task 7); `matchesAll` (Task 8).
- Produces: `createAction(config, ctx)` → `{ execute(root) => Promise<void> }`.
  `ctx` is `{ shouldAllow(categoryCode) => boolean, runMethod(name, root) => Promise<void> }`.
  Supported: `click`, `multiclick`, `list`, `consent`, `ifcss`, `waitcss`, `foreach`, `hide`, `wait`, `close`, `ifallowall`, `ifallownone`. Unsupported types (`slide`, `runrooted`, `runmethod`) throw `UnsupportedAction`, which Task 11 catches to abandon the rule.

- [ ] **Step 1: Write the failing test**

```js
// test/actions.test.js
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createAction, UnsupportedAction } from '../src/engine/actions.js';

const ctx = { shouldAllow: () => false, runMethod: vi.fn() };
const run = (config, root = document) => createAction(config, ctx).execute(root);

describe('click', () => {
  it('clicks the first match only', async () => {
    document.body.innerHTML = `<button class="b">a</button><button class="b">b</button>`;
    const spies = [...document.querySelectorAll('.b')].map((el) => vi.spyOn(el, 'click'));
    await run({ type: 'click', target: { selector: '.b' } });
    expect(spies[0]).toHaveBeenCalled();
    expect(spies[1]).not.toHaveBeenCalled();
  });

  it('is a no-op when nothing matches', async () => {
    document.body.innerHTML = ``;
    await expect(run({ type: 'click', target: { selector: '.gone' } })).resolves.toBeUndefined();
  });
});

describe('multiclick', () => {
  it('clicks every match', async () => {
    document.body.innerHTML = `<button class="b">a</button><button class="b">b</button>`;
    const spies = [...document.querySelectorAll('.b')].map((el) => vi.spyOn(el, 'click'));
    await run({ type: 'multiclick', target: { selector: '.b' } });
    expect(spies.every((s) => s.mock.calls.length === 1)).toBe(true);
  });
});

describe('list', () => {
  it('runs child actions in order', async () => {
    document.body.innerHTML = `<button id="one">1</button><button id="two">2</button>`;
    const order = [];
    for (const id of ['one', 'two']) {
      document.querySelector(`#${id}`).addEventListener('click', () => order.push(id));
    }
    await run({ type: 'list', actions: [
      { type: 'click', target: { selector: '#one' } },
      { type: 'click', target: { selector: '#two' } },
    ]});
    expect(order).toEqual(['one', 'two']);
  });
});

describe('consent', () => {
  it('unticks an enabled category', async () => {
    document.body.innerHTML = `<input type="checkbox" id="marketing" checked>`;
    await run({ type: 'consent', consents: [{
      type: 'E',
      matcher: { type: 'checkbox', target: { selector: '#marketing' } },
      toggleAction: { type: 'click', target: { selector: '#marketing' } },
    }]});
    expect(document.querySelector('#marketing').checked).toBe(false);
  });

  it('leaves an already-off category alone', async () => {
    document.body.innerHTML = `<input type="checkbox" id="marketing">`;
    const spy = vi.spyOn(document.querySelector('#marketing'), 'click');
    await run({ type: 'consent', consents: [{
      type: 'E',
      matcher: { type: 'checkbox', target: { selector: '#marketing' } },
      toggleAction: { type: 'click', target: { selector: '#marketing' } },
    }]});
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses to toggle when the rule gives no matcher', async () => {
    document.body.innerHTML = `<input type="checkbox" id="m" checked>`;
    const spy = vi.spyOn(document.querySelector('#m'), 'click');
    await run({ type: 'consent', consents: [{
      type: 'E', toggleAction: { type: 'click', target: { selector: '#m' } },
    }]});
    expect(spy).not.toHaveBeenCalled();
  });

  it('prefers falseAction over toggling when both are given', async () => {
    // The highest-risk ordering in the engine: if toggling won instead,
    // an already-on category could be double-handled and left enabled.
    document.body.innerHTML =
      `<input type="checkbox" id="m" checked><button id="reject">Reject</button>`;
    const toggle = vi.spyOn(document.querySelector('#m'), 'click');
    const direct = vi.spyOn(document.querySelector('#reject'), 'click');
    await run({ type: 'consent', consents: [{
      type: 'E',
      falseAction: { type: 'click', target: { selector: '#reject' } },
      matcher: { type: 'checkbox', target: { selector: '#m' } },
      toggleAction: { type: 'click', target: { selector: '#m' } },
    }]});
    expect(direct).toHaveBeenCalled();
    expect(toggle).not.toHaveBeenCalled();
  });
});

describe('wait and close', () => {
  it('wait resolves after its configured delay', async () => {
    const t0 = Date.now();
    await run({ type: 'wait', waitTime: 30 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(25);
  });

  it('close calls the global close', async () => {
    const spy = vi.fn();
    const original = globalThis.close;
    globalThis.close = spy;
    await run({ type: 'close' });
    globalThis.close = original;
    expect(spy).toHaveBeenCalled();
  });
});

describe('waitcss', () => {
  it('resolves once the selector appears', async () => {
    document.body.innerHTML = ``;
    setTimeout(() => { document.body.innerHTML = `<div id="late">here</div>`; }, 20);
    await run({ type: 'waitcss', target: { selector: '#late' }, timeout: 500 });
    expect(document.querySelector('#late')).not.toBe(null);
  });

  it('gives up at the timeout instead of hanging', async () => {
    document.body.innerHTML = ``;
    const t0 = Date.now();
    await run({ type: 'waitcss', target: { selector: '#never' }, timeout: 60 });
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('waits for absence when negated', async () => {
    document.body.innerHTML = `<div id="going">x</div>`;
    setTimeout(() => { document.querySelector('#going').remove(); }, 20);
    await run({ type: 'waitcss', target: { selector: '#going' }, negated: true, timeout: 500 });
    expect(document.querySelector('#going')).toBe(null);
  });
});

describe('ifallowall', () => {
  it('takes the false branch, because nothing is ever allowed', async () => {
    document.body.innerHTML = `<button id="t">t</button><button id="f">f</button>`;
    const t = vi.spyOn(document.querySelector('#t'), 'click');
    const f = vi.spyOn(document.querySelector('#f'), 'click');
    await run({ type: 'ifallowall',
      trueAction: { type: 'click', target: { selector: '#t' } },
      falseAction: { type: 'click', target: { selector: '#f' } } });
    expect(f).toHaveBeenCalled();
    expect(t).not.toHaveBeenCalled();
  });
});

describe('ifcss', () => {
  it('runs trueAction when present', async () => {
    document.body.innerHTML = `<div id="x"></div><button id="t">t</button>`;
    const spy = vi.spyOn(document.querySelector('#t'), 'click');
    await run({ type: 'ifcss', target: { selector: '#x' },
      trueAction: { type: 'click', target: { selector: '#t' } } });
    expect(spy).toHaveBeenCalled();
  });

  it('runs falseAction when absent', async () => {
    document.body.innerHTML = `<button id="f">f</button>`;
    const spy = vi.spyOn(document.querySelector('#f'), 'click');
    await run({ type: 'ifcss', target: { selector: '#nope' },
      falseAction: { type: 'click', target: { selector: '#f' } } });
    expect(spy).toHaveBeenCalled();
  });
});

describe('foreach', () => {
  it('scopes the child action to each match', async () => {
    document.body.innerHTML =
      `<div class="row"><input type="checkbox" checked></div>` +
      `<div class="row"><input type="checkbox" checked></div>`;
    await run({ type: 'foreach', target: { selector: '.row' },
      action: { type: 'click', target: { selector: 'input' } } });
    expect([...document.querySelectorAll('input')].every((i) => !i.checked)).toBe(true);
  });
});

describe('hide', () => {
  it('sets display none', async () => {
    document.body.innerHTML = `<div id="b">banner</div>`;
    await run({ type: 'hide', target: { selector: '#b' } });
    expect(document.querySelector('#b').style.display).toBe('none');
  });
});

describe('ifallownone', () => {
  it('takes the true branch because we reject everything', async () => {
    document.body.innerHTML = `<button id="t">t</button>`;
    const spy = vi.spyOn(document.querySelector('#t'), 'click');
    await run({ type: 'ifallownone', trueAction: { type: 'click', target: { selector: '#t' } } });
    expect(spy).toHaveBeenCalled();
  });
});

describe('unsupported', () => {
  it('throws UnsupportedAction for slide', async () => {
    await expect(run({ type: 'slide' })).rejects.toBeInstanceOf(UnsupportedAction);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/actions.test.js`
Expected: FAIL — cannot resolve module

- [ ] **Step 3: Implement src/engine/actions.js**

```js
import { queryAll, sleep, waitFor } from './tools.js';
import { createMatcher } from './matchers.js';

export class UnsupportedAction extends Error {
  constructor(type) {
    super(`unsupported action: ${type}`);
    this.name = 'UnsupportedAction';
  }
}

const TYPES = {
  click: (c) => async (root) => {
    queryAll(root, c.target)[0]?.click();
  },

  multiclick: (c) => async (root) => {
    for (const el of queryAll(root, c.target)) el.click();
  },

  list: (c, ctx) => async (root) => {
    for (const child of c.actions ?? []) {
      await createAction(child, ctx).execute(root);
    }
  },

  wait: (c) => async () => { await sleep(c.waitTime ?? 250); },

  waitcss: (c) => async (root) => {
    await waitFor(
      () => {
        const hit = queryAll(root, { selector: c.target?.selector, displayFilter: c.target?.displayFilter }).length > 0;
        return c.negated ? !hit : hit;
      },
      c.timeout ?? 2000,
      c.retries ? Math.max(10, (c.timeout ?? 2000) / c.retries) : 50,
    );
  },

  hide: (c) => async (root) => {
    for (const el of queryAll(root, c.target)) {
      el.style.setProperty('display', 'none', 'important');
    }
  },

  close: () => async () => { globalThis.close?.(); },

  foreach: (c, ctx) => async (root) => {
    for (const el of queryAll(root, c.target)) {
      await createAction(c.action, ctx).execute(el);
    }
  },

  ifcss: (c, ctx) => async (root) => {
    const present = queryAll(root, c.target).length > 0;
    const branch = present ? c.trueAction : c.falseAction;
    if (branch) await createAction(branch, ctx).execute(root);
  },

  // We always reject every category, so `allow all` is never true
  // and `allow none` is always true. Both collapse to constants.
  ifallowall: (c, ctx) => async (root) => {
    if (c.falseAction) await createAction(c.falseAction, ctx).execute(root);
  },

  ifallownone: (c, ctx) => async (root) => {
    if (c.trueAction) await createAction(c.trueAction, ctx).execute(root);
  },

  consent: (c, ctx) => async (root) => {
    for (const consent of c.consents ?? []) {
      const allow = ctx.shouldAllow(consent.type);

      // Explicit true/false actions take precedence over toggling.
      const direct = allow ? consent.trueAction : consent.falseAction;
      if (direct) {
        await createAction(direct, ctx).execute(root);
        continue;
      }

      // Toggling requires a matcher — without one we cannot read current
      // state, and a blind click could switch a category ON. Skip instead.
      if (!consent.toggleAction || !consent.matcher) continue;

      const isOn = createMatcher(consent.matcher).matches(root);
      if (isOn !== allow) {
        await createAction(consent.toggleAction, ctx).execute(root);
      }
    }
  },
};

export function createAction(config, ctx) {
  const make = TYPES[config?.type];
  if (!make) {
    return { execute: async () => { throw new UnsupportedAction(config?.type); } };
  }
  const fn = make(config, ctx);
  return { execute: (root) => fn(root ?? document) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/actions.test.js`
Expected: PASS (14 tests)

- [ ] **Step 5: Commit**

```bash
git add src/engine/actions.js test/actions.test.js
git commit -m "feat: rule DSL actions covering 97% of vendored rules"
```

---

### Task 10: CMP orchestration

**Files:**
- Create: `src/engine/cmp.js`, `src/engine/index.js`
- Test: `test/engine.test.js`, `test/fixtures/cookiebot.html`

**Interfaces:**
- Consumes: `matchesAll` (Task 8), `createAction`, `UnsupportedAction` (Task 9).
- Produces: `class CMP { name; isPresent(root); isShowing(root); run(root) }` and `runEngine(bundle, root, opts)` → `Promise<{ handled: string|null, reason: string }>`.

Method order is fixed: `OPEN_OPTIONS` → `DO_CONSENT` → `SAVE_CONSENT` → `HIDE_CMP`. `UTILITY` is never run directly.

**Fixture:** save a real Cookiebot banner to `test/fixtures/cookiebot.html` — a container `#CybotCookiebotDialog`, a details button `#CybotCookiebotDialogBodyLevelButtonDetails`, three category checkboxes (`...LevelButtonPreferences`, `...Statistics`, `...Marketing`) all checked, and a save button `#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowallSelection`.

- [ ] **Step 1: Write the failing test**

```js
// test/engine.test.js
// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach } from 'vitest';
import { runEngine } from '../src/engine/index.js';

const BUNDLE = JSON.parse(readFileSync('src/rules/bundle.json', 'utf8'));

beforeEach(() => {
  document.body.innerHTML = readFileSync('test/fixtures/cookiebot.html', 'utf8');
  // jsdom gives every element a zero rect; make the banner "visible".
  for (const el of document.querySelectorAll('*')) {
    el.getBoundingClientRect = () => ({ width: 200, height: 50 });
  }
});

describe('runEngine on a real Cookiebot banner', () => {
  it('identifies cookiebot', async () => {
    const r = await runEngine(BUNDLE, document);
    expect(r.handled).toBe('cookiebot');
  });

  it('turns every consent category off', async () => {
    await runEngine(BUNDLE, document);
    const boxes = [...document.querySelectorAll('input[type=checkbox]')];
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.every((b) => !b.checked)).toBe(true);
  });

  it('reports no match on a page with no banner', async () => {
    document.body.innerHTML = `<p>ordinary page</p>`;
    const r = await runEngine(BUNDLE, document);
    expect(r.handled).toBe(null);
    expect(r.reason).toBe('no-cmp-detected');
  });

  it('abandons a rule that needs an unsupported action', async () => {
    const bundle = { rules: { fake: {
      detectors: [{ presentMatcher: [{ type: 'css', target: { selector: 'body' } }],
                    showingMatcher: [{ type: 'css', target: { selector: 'body' } }] }],
      methods: [{ name: 'DO_CONSENT', action: { type: 'slide' } }],
    }}};
    const r = await runEngine(bundle, document);
    expect(r.handled).toBe(null);
    expect(r.reason).toBe('unsupported-action');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/engine.test.js`
Expected: FAIL — cannot resolve `../src/engine/index.js`

- [ ] **Step 3: Implement src/engine/cmp.js**

```js
import { matchesAll } from './matchers.js';
import { createAction, UnsupportedAction } from './actions.js';

const ORDER = ['OPEN_OPTIONS', 'DO_CONSENT', 'SAVE_CONSENT', 'HIDE_CMP'];

export class CMP {
  constructor(name, config, ctx) {
    this.name = name;
    this.config = config;
    this.ctx = ctx;
  }

  isPresent(root) {
    return (this.config.detectors ?? []).some((d) => matchesAll(d.presentMatcher, root));
  }

  isShowing(root) {
    return (this.config.detectors ?? []).some((d) => matchesAll(d.showingMatcher, root));
  }

  method(name) {
    return (this.config.methods ?? []).find((m) => m.name === name);
  }

  /** Throws UnsupportedAction if any method needs an action we do not implement. */
  async run(root) {
    for (const name of ORDER) {
      const m = this.method(name);
      if (!m?.action) continue;
      await createAction(m.action, this.ctx).execute(root);
    }
  }
}

export { UnsupportedAction };
```

- [ ] **Step 4: Implement src/engine/index.js**

```js
import { CMP, UnsupportedAction } from './cmp.js';

// Every consent category is rejected. See the spec: "necessary" is never a
// category CMPs expose, so there is nothing to preserve.
const REJECT_ALL = { shouldAllow: () => false };

export async function runEngine(bundle, root = document, { timeoutMs = 8000 } = {}) {
  const rules = bundle?.rules ?? {};

  for (const [name, config] of Object.entries(rules)) {
    const cmp = new CMP(name, config, REJECT_ALL);

    let detected = false;
    try {
      detected = cmp.isPresent(root) && cmp.isShowing(root);
    } catch {
      continue; // a malformed detector must not stop the sweep
    }
    if (!detected) continue;

    try {
      await Promise.race([
        cmp.run(root),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), timeoutMs)),
      ]);
      return { handled: name, reason: 'ok' };
    } catch (e) {
      const reason = e instanceof UnsupportedAction ? 'unsupported-action' : 'error';
      return { handled: null, reason, cmp: name, error: e.message };
    }
  }

  return { handled: null, reason: 'no-cmp-detected' };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/engine.test.js`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/engine/cmp.js src/engine/index.js test/engine.test.js test/fixtures/cookiebot.html
git commit -m "feat: CMP detection and method orchestration"
```

---

### Task 11: Newsletter heuristic

**Files:**
- Create: `src/content/newsletter.js`
- Test: `test/newsletter.test.js`, fixtures `test/fixtures/newsletter-modal.html`, `login-modal.html`, `cart-drawer.html`

**Interfaces:**
- Consumes: `isShown` (Task 7).
- Produces: `looksLikeNewsletter(el)`, `findNewsletterModals(root)`, `dismissNewsletter(el)`.

Requires all three signals — overlay positioning, an email input, subscribe-ish text — and refuses on a password field or more than two inputs. The negative tests are the point of this task.

- [ ] **Step 1: Write the failing test**

```js
// test/newsletter.test.js
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { looksLikeNewsletter, findNewsletterModals, dismissNewsletter } from '../src/content/newsletter.js';

const overlay = (inner) =>
  `<div id="m" style="position:fixed;z-index:9999">${inner}</div>`;

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.style.overflow = '';
  document.body.style.overflow = '';
});

const mount = (html) => {
  document.body.innerHTML = html;
  for (const el of document.querySelectorAll('*')) {
    el.getBoundingClientRect = () => ({ width: 400, height: 300 });
  }
  return document.querySelector('#m');
};

describe('looksLikeNewsletter — positives', () => {
  it('flags an overlay with an email field and subscribe copy', () => {
    const el = mount(overlay(`<h2>Join our newsletter</h2>
      <input type="email"><button>Subscribe</button>`));
    expect(looksLikeNewsletter(el)).toBe(true);
  });

  it('flags a discount-code signup', () => {
    const el = mount(overlay(`<p>Get 10% off your first order</p>
      <input type="email" placeholder="Email address"><button>Sign up</button>`));
    expect(looksLikeNewsletter(el)).toBe(true);
  });
});

describe('looksLikeNewsletter — negatives', () => {
  it('leaves a login modal alone (password field)', () => {
    const el = mount(overlay(`<h2>Sign in</h2>
      <input type="email"><input type="password"><button>Sign in</button>`));
    expect(looksLikeNewsletter(el)).toBe(false);
  });

  it('leaves a checkout form alone (too many inputs)', () => {
    const el = mount(overlay(`<h2>Subscribe & checkout</h2>
      <input type="email"><input name="a"><input name="b"><button>Go</button>`));
    expect(looksLikeNewsletter(el)).toBe(false);
  });

  it('leaves a cookie banner alone (no email field)', () => {
    const el = mount(overlay(`<p>We use cookies</p><button>Accept</button>`));
    expect(looksLikeNewsletter(el)).toBe(false);
  });

  it('leaves inline footer signup alone (not an overlay)', () => {
    document.body.innerHTML =
      `<footer id="m"><input type="email"><button>Subscribe</button></footer>`;
    for (const el of document.querySelectorAll('*')) {
      el.getBoundingClientRect = () => ({ width: 400, height: 100 });
    }
    expect(looksLikeNewsletter(document.querySelector('#m'))).toBe(false);
  });

  it('leaves a hidden overlay alone', () => {
    document.body.innerHTML = overlay(`<input type="email"><button>Subscribe</button>`);
    expect(looksLikeNewsletter(document.querySelector('#m'))).toBe(false);
  });

  it('leaves a passwordless magic-link sign-in alone', () => {
    // All three positive signals present and no password field, yet this is
    // an auth flow. Dismissing it would break the site's login.
    const el = mount(overlay(`<h2>Sign up or log in</h2>
      <p>We'll email you a magic link.</p>
      <input type="email"><button>Continue</button>`));
    expect(looksLikeNewsletter(el)).toBe(false);
  });

  it('leaves an OAuth account overlay alone', () => {
    const el = mount(overlay(`<h2>Sign up for 10% off</h2>
      <button>Continue with Google</button>
      <input type="email"><button>Sign up</button>`));
    expect(looksLikeNewsletter(el)).toBe(false);
  });

  it('leaves an overlay offering an existing-account path alone', () => {
    const el = mount(overlay(`<h2>Join us</h2><input type="email">
      <button>Sign up</button><a>Already have an account?</a>`));
    expect(looksLikeNewsletter(el)).toBe(false);
  });

  it('leaves a username-autocomplete field alone', () => {
    const el = mount(overlay(`<h2>Subscribe</h2>
      <input type="email" autocomplete="username"><button>Go</button>`));
    expect(looksLikeNewsletter(el)).toBe(false);
  });

  // Each of these carries a REAL SUBSCRIBE_WORDS match, so the only thing
  // stopping dismissal is the specific refusal named. Remove that refusal and
  // the test flips — which is what makes it a guard rather than a decoration.
  it('refuses a password field even when the copy is pure marketing', () => {
    const el = mount(overlay(`<h2>Subscribe and get 10% off</h2>
      <input type="email"><input type="password"><button>Go</button>`));
    expect(looksLikeNewsletter(el)).toBe(false);
  });

  it('refuses an existing-account link even under newsletter copy', () => {
    const el = mount(overlay(`<h2>Join our newsletter</h2>
      <input type="email"><button>Go</button><a>Already have an account?</a>`));
    expect(looksLikeNewsletter(el)).toBe(false);
  });

  it('refuses a magic link even under newsletter copy', () => {
    const el = mount(overlay(`<h2>Subscribe for updates</h2>
      <p>We'll send you a magic link.</p><input type="email">`));
    expect(looksLikeNewsletter(el)).toBe(false);
  });

  it('refuses a registration wall that dangles a discount', () => {
    // The realistic e-commerce pattern: account creation sold with a coupon.
    const el = mount(overlay(`<h2>Create your free account</h2>
      <p>Get exclusive discount access.</p>
      <input type="email"><button>Continue</button>`));
    expect(looksLikeNewsletter(el)).toBe(false);
  });

  it('leaves an account signup whose only marketing word is "sign up"', () => {
    // Phrased to dodge every AUTH_MARKER. It survives because "sign up" is
    // not a positive signal on its own — the phrase is shared with
    // registration forms and cannot tell them apart.
    const el = mount(overlay(`<h2>New here?</h2>
      <p>Sign up and we'll email you a link to access your account.</p>
      <input type="email"><button>Continue</button>`));
    expect(looksLikeNewsletter(el)).toBe(false);
  });
});

describe('dismissNewsletter', () => {
  it('prefers clicking a close control', () => {
    const el = mount(overlay(`<button aria-label="Close">x</button>
      <input type="email"><button>Subscribe</button>`));
    let clicked = false;
    el.querySelector('[aria-label=Close]').addEventListener('click', () => { clicked = true; });
    dismissNewsletter(el);
    expect(clicked).toBe(true);
  });

  it('hides the element when there is no close control', () => {
    const el = mount(overlay(`<input type="email"><button>Subscribe</button>`));
    dismissNewsletter(el);
    expect(el.style.display).toBe('none');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/newsletter.test.js`
Expected: FAIL — cannot resolve module

- [ ] **Step 3: Implement src/content/newsletter.js**

```js
import { isShown } from '../engine/tools.js';

// Deliberately excludes "sign up" / "signup". Those are the one phrase a
// newsletter popup and an account-creation overlay genuinely share, so they
// cannot distinguish the two. Real newsletter popups almost always also say
// "newsletter", "subscribe", "% off", "discount", or "mailing list"; an
// overlay whose ONLY marketing signal is "sign up" is indistinguishable from
// a registration form, and we leave those alone.
const SUBSCRIBE_WORDS = [
  'newsletter', 'subscribe', 'join our', 'mailing list',
  '% off', 'discount', 'first order', 'stay in the loop', 'get updates',
];

// Overlays that are really account or auth flows. Any of these outweighs
// every positive signal. A passwordless "magic link" sign-in has an email
// input, overlay positioning, and "Sign up" copy — all three signals — yet
// dismissing it breaks the site's login. Missing a newsletter is cheap;
// destroying an auth flow is not.
const AUTH_MARKERS = [
  'sign in', 'signin', 'log in', 'login', 'already have an account',
  'continue with google', 'continue with apple', 'continue with facebook',
  'magic link', 'verification code', 'one-time code',
  'forgot password', 'reset password',
  // Registration walls. "Create your free account — get exclusive discount
  // access" carries a real marketing word and would otherwise be dismissed,
  // which is the expensive kind of mistake.
  'create account', 'create an account', 'create your account',
  'free account', 'your account', 'register',
];

const CLOSE_SELECTORS = [
  '[aria-label*="close" i]', '[title*="close" i]', 'button.close', '.modal-close',
  '[class*="close" i][role="button"]', 'button[data-dismiss]',
];

function isOverlay(el) {
  const style = el.ownerDocument.defaultView.getComputedStyle(el);
  if (!['fixed', 'absolute', 'sticky'].includes(style.position)) return false;
  const z = parseInt(style.zIndex, 10);
  return Number.isNaN(z) ? true : z >= 100;
}

export function looksLikeNewsletter(el) {
  if (!el || !isShown(el)) return false;
  if (!isOverlay(el)) return false;

  // Hard refusals — these are the shapes we must never touch.
  if (el.querySelector('input[type=password]')) return false;
  if (el.querySelector('input[autocomplete="username"]')) return false;
  const inputs = el.querySelectorAll('input:not([type=hidden]):not([type=submit])');
  if (inputs.length > 2) return false;

  const text = (el.textContent ?? '').toLowerCase();
  if (AUTH_MARKERS.some((w) => text.includes(w))) return false;

  const hasEmail = Boolean(
    el.querySelector('input[type=email], input[name*="email" i], input[placeholder*="email" i]')
  );
  if (!hasEmail) return false;

  return SUBSCRIBE_WORDS.some((w) => text.includes(w));
}

export function findNewsletterModals(root = document) {
  const candidates = root.querySelectorAll('div, section, aside, dialog');
  return [...candidates].filter(looksLikeNewsletter);
}

export function dismissNewsletter(el) {
  for (const sel of CLOSE_SELECTORS) {
    const btn = el.querySelector(sel);
    if (btn && isShown(btn)) {
      btn.click();
      return 'clicked-close';
    }
  }
  el.style.setProperty('display', 'none', 'important');
  return 'hidden';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/newsletter.test.js`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add src/content/newsletter.js test/newsletter.test.js test/fixtures/
git commit -m "feat: conservative newsletter modal heuristic"
```

---

### Task 12: Cosmetic cookie fallback and scroll restore

**Files:**
- Create: `src/content/cosmetic.js`, `src/content/scroll.js`
- Test: `test/cosmetic.test.js`

**Interfaces:**
- Consumes: `isShown` (Task 7).
- Produces: `hideCookieBanners(root)` → `number` hidden; `restoreScroll(doc)`.

- [ ] **Step 1: Write the failing test**

```js
// test/cosmetic.test.js
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { hideCookieBanners } from '../src/content/cosmetic.js';
import { restoreScroll } from '../src/content/scroll.js';

const mount = (html) => {
  document.body.innerHTML = html;
  for (const el of document.querySelectorAll('*')) {
    el.getBoundingClientRect = () => ({ width: 600, height: 90 });
  }
};

beforeEach(() => { document.body.innerHTML = ''; });

describe('hideCookieBanners', () => {
  it('hides a fixed banner mentioning cookies', () => {
    mount(`<div id="b" style="position:fixed;z-index:500">
      We use cookies to improve your experience. <button>Accept</button></div>`);
    expect(hideCookieBanners(document)).toBe(1);
    expect(document.querySelector('#b').style.display).toBe('none');
  });

  // Each negative satisfies every guard EXCEPT the one named, so deleting
  // that guard flips the test. A fixture failing two guards at once proves
  // nothing about either.
  it('ignores cookie language that is not in a fixed or sticky element', () => {
    // Isolates the position guard: has cookie words AND an accept control.
    mount(`<div id="b"><p>We use cookies. Read our cookie policy.</p>
      <button>Accept</button></div>`);
    expect(hideCookieBanners(document)).toBe(0);
  });

  it('ignores a fixed bar with an accept-ish control but no cookie language', () => {
    // Isolates the cookie-language guard: fixed AND has a matching button.
    mount(`<nav id="b" style="position:fixed;z-index:500">
      <button>Accept</button> Home About Contact</nav>`);
    expect(hideCookieBanners(document)).toBe(0);
  });

  it('ignores an element too long to be a banner', () => {
    // Isolates the length cap — the guard that stops us blanking a page
    // whose whole wrapper happens to mention cookies.
    const filler = 'lorem ipsum dolor sit amet. '.repeat(80); // > 1200 chars
    mount(`<div id="b" style="position:fixed;z-index:500">
      <p>We use cookies. ${filler}</p><button>Accept</button></div>`);
    expect(hideCookieBanners(document)).toBe(0);
  });
});

describe('restoreScroll', () => {
  it('clears overflow hidden on body and html', () => {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    restoreScroll(document);
    expect(document.body.style.overflow).toBe('');
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('clears a fixed body position', () => {
    document.body.style.position = 'fixed';
    restoreScroll(document);
    expect(document.body.style.position).toBe('');
  });

  it('removes scroll-lock classes', () => {
    document.body.className = 'modal-open some-app-class no-scroll';
    restoreScroll(document);
    expect(document.body.classList.contains('modal-open')).toBe(false);
    expect(document.body.classList.contains('no-scroll')).toBe(false);
    // Unrelated classes must survive — we restore scrolling, not restyle.
    expect(document.body.classList.contains('some-app-class')).toBe(true);
  });

  it('never adds a restriction to an unlocked page', () => {
    document.body.style.overflow = 'auto';
    restoreScroll(document);
    expect(document.body.style.overflow).toBe('auto');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/cosmetic.test.js`
Expected: FAIL — cannot resolve modules

- [ ] **Step 3: Implement src/content/cosmetic.js**

```js
import { isShown } from '../engine/tools.js';

const COOKIE_WORDS = [
  'cookie', 'cookies', 'consent', 'gdpr', 'privacy preferences', 'tracking',
];
const ACCEPT_WORDS = ['accept', 'agree', 'allow', 'got it', 'ok', 'reject', 'decline'];

function looksLikeBanner(el) {
  if (!isShown(el)) return false;
  const style = el.ownerDocument.defaultView.getComputedStyle(el);
  if (!['fixed', 'sticky'].includes(style.position)) return false;

  const text = (el.textContent ?? '').toLowerCase();
  if (text.length > 1200) return false; // whole-page wrapper, not a banner

  const mentionsCookies = COOKIE_WORDS.some((w) => text.includes(w));
  const hasButton = [...el.querySelectorAll('button, a, [role=button]')].some((b) =>
    ACCEPT_WORDS.some((w) => (b.textContent ?? '').toLowerCase().trim().includes(w))
  );
  return mentionsCookies && hasButton;
}

export function hideCookieBanners(root = document) {
  let n = 0;
  for (const el of root.querySelectorAll('div, section, aside, dialog, footer, nav')) {
    if (looksLikeBanner(el)) {
      el.style.setProperty('display', 'none', 'important');
      n += 1;
    }
  }
  return n;
}
```

- [ ] **Step 4: Implement src/content/scroll.js**

```js
// CMPs and modals routinely lock scrolling and forget to unlock it once
// their element is gone. Always call this after a dismissal.
const LOCK_CLASSES = [
  'modal-open', 'no-scroll', 'noscroll', 'overflow-hidden',
  'cookie-consent-open', 'body-lock',
];

export function restoreScroll(doc = document) {
  for (const el of [doc.documentElement, doc.body]) {
    if (!el) continue;
    if (el.style.overflow === 'hidden') el.style.overflow = '';
    if (el.style.position === 'fixed') el.style.position = '';
    el.classList.remove(...LOCK_CLASSES);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/cosmetic.test.js`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/content/cosmetic.js src/content/scroll.js test/cosmetic.test.js
git commit -m "feat: cosmetic cookie fallback and scroll restore"
```

---

### Task 13: Content script wiring

**Files:**
- Create: `src/content/index.js`
- Test: `test/content.test.js`

**Interfaces:**
- Consumes: everything from Tasks 7–12, plus `getSettings`/`isPaused` (Task 2) and the bundle (Task 6).
- Produces: `createSweeper({ settings, bundle, root, engine })` → `{ sweep(), start(), stop(), tripped }`. `engine` defaults to `runEngine` and is an explicit constructor dependency, not a mutable property — tests pass a stub through the signature.

Splitting `createSweeper` out from the module's side-effecting entry is what makes the observer loop testable without a browser.

- [ ] **Step 1: Write the failing test**

```js
// test/content.test.js
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSweeper } from '../src/content/index.js';

const EMPTY_BUNDLE = { rules: {} };
const ON = { cookieBanners: true, newsletters: true, pausedSites: [] };

const mount = (html) => {
  document.body.innerHTML = html;
  for (const el of document.querySelectorAll('*')) {
    el.getBoundingClientRect = () => ({ width: 400, height: 300 });
  }
};

beforeEach(() => { document.body.innerHTML = ''; });

describe('sweeper', () => {
  it('dismisses a newsletter modal when the toggle is on', async () => {
    mount(`<div id="m" style="position:fixed;z-index:9999">
      <h2>Join our newsletter</h2><input type="email"><button>Subscribe</button></div>`);
    await createSweeper({ settings: ON, bundle: EMPTY_BUNDLE }).sweep();
    expect(document.querySelector('#m').style.display).toBe('none');
  });

  it('leaves it alone when the newsletter toggle is off', async () => {
    mount(`<div id="m" style="position:fixed;z-index:9999">
      <h2>Join our newsletter</h2><input type="email"><button>Subscribe</button></div>`);
    await createSweeper({
      settings: { ...ON, newsletters: false }, bundle: EMPTY_BUNDLE,
    }).sweep();
    expect(document.querySelector('#m').style.display).toBe('');
  });

  it('restores scroll after dismissing something', async () => {
    document.body.style.overflow = 'hidden';
    mount(`<div id="m" style="position:fixed;z-index:9999">
      <h2>Newsletter</h2><input type="email"><button>Subscribe</button></div>`);
    document.body.style.overflow = 'hidden';
    await createSweeper({ settings: ON, bundle: EMPTY_BUNDLE }).sweep();
    expect(document.body.style.overflow).toBe('');
  });

  it('stops sweeping a domain after two consecutive errors', async () => {
    const engine = vi.fn(async () => { throw new Error('boom'); });
    const s = createSweeper({ settings: ON, bundle: EMPTY_BUNDLE, engine });
    await s.sweep(); await s.sweep(); await s.sweep();
    expect(engine).toHaveBeenCalledTimes(2);
    expect(s.tripped).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/content.test.js`
Expected: FAIL — cannot resolve module

- [ ] **Step 3: Implement src/content/index.js**

```js
import { getSettings, isPaused } from '../settings.js';
import { runEngine } from '../engine/index.js';
import { hideCookieBanners } from './cosmetic.js';
import { findNewsletterModals, dismissNewsletter } from './newsletter.js';
import { restoreScroll } from './scroll.js';
import bundle from '../rules/bundle.json';

const QUIET_MS = 10_000;
const DEBOUNCE_MS = 300;
const MAX_ERRORS = 2;

export function createSweeper({ settings, bundle, root = document, engine = runEngine }) {
  const state = {
    tripped: false,
    errors: 0,
    handled: false,

    async sweep() {
      if (state.tripped) return;
      let didSomething = false;

      if (settings.cookieBanners && !state.handled) {
        try {
          const r = await engine(bundle, root);
          state.errors = 0;
          if (r.handled) {
            state.handled = true;
            didSomething = true;
          } else {
            // Either no rule matched, or one matched but hit an action we
            // don't implement. Both fall back to hiding — and note the
            // fallback runs ONLY here, never alongside a successful rule.
            didSomething = hideCookieBanners(root) > 0;
          }
        } catch {
          state.errors += 1;
          if (state.errors >= MAX_ERRORS) state.tripped = true;
        }
      }

      if (settings.newsletters) {
        for (const el of findNewsletterModals(root)) {
          try { dismissNewsletter(el); didSomething = true; } catch { /* never break the page */ }
        }
      }

      if (didSomething) restoreScroll(root.ownerDocument ?? document);
    },

    start() {
      let timer = null;
      let quiet = null;
      const observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(() => state.sweep(), DEBOUNCE_MS);
      });
      observer.observe(root.body ?? root, { childList: true, subtree: true });
      state.stop = () => { observer.disconnect(); clearTimeout(timer); clearTimeout(quiet); };
      quiet = setTimeout(() => state.stop(), QUIET_MS);
      state.sweep();
    },

    stop() {},
  };
  return state;
}

async function main() {
  const settings = await getSettings();
  if (isPaused(settings, location.hostname)) return;
  createSweeper({ settings, bundle }).start();
}

if (typeof chrome !== 'undefined' && chrome.storage) main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/content.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the full suite and build**

Run: `npm test && npm run build`
Expected: all suites PASS, `built dist/`

- [ ] **Step 6: Commit**

```bash
git add src/content/index.js test/content.test.js
git commit -m "feat: content script sweep loop with circuit breaker"
```

---

### Task 14: Manual QA and store readiness

**Files:**
- Create: `docs/QA.md`
- Modify: `README.md` (replace the Status section)

The `contentSettings` layer cannot be tested headlessly, so it gets a written checklist that a human runs against a real Chrome profile.

- [ ] **Step 1: Write docs/QA.md**

Checklist, each item with expected result:

1. Load unpacked from `dist/`. Open `chrome://settings/content/notifications` — confirm it reads "Don't allow sites to send notifications."
2. Toggle notifications off in the popup; reload the settings page; confirm it flips back.
3. Repeat for location, camera, microphone, popups, automatic downloads, sound.
4. Enable session-only cookies, confirm `chrome://settings/content/cookies` shows the session-only state, then disable it again.
5. Visit `https://global-privacy-control.glitch.me/` with GPC on; confirm it reports the signal as detected.
6. Visit five sites known to use each of OneTrust, Cookiebot, Didomi, Usercentrics, Quantcast. Confirm the banner disappears and, where the CMP exposes a preferences screen, that categories are off.
7. Visit five newsletter-heavy sites. Confirm the modal is dismissed and the page scrolls.
8. **Negative pass:** on three sites, open a login modal, a cart drawer, and an age gate. Confirm none are dismissed.
9. Pause on a site, reload, confirm nothing is touched. Resume, confirm behaviour returns.
10. Note the Chrome version — `sound` requires 141+; on older builds the popup should list it under not-enforced.

- [ ] **Step 2: Update README status section**

Replace "Pre-implementation..." with install-from-source instructions (`npm install && npm run build`, load unpacked from `dist/`) and a link to `docs/QA.md`.

- [ ] **Step 3: Run the QA checklist**

Work through every item. Record failures as issues; do not mark this task complete with open items in sections 6–8, which are the correctness-critical ones.

- [ ] **Step 4: Commit**

```bash
git add docs/QA.md README.md
git commit -m "docs: manual QA checklist and install instructions"
```

---

## Self-Review

**Spec coverage.** Three enforcement layers — Tasks 3, 4, 13. All eleven toggles — Task 5, mapped to enforcement in 3 and 4. Rule engine with graceful degradation — Tasks 7–10, `UnsupportedAction` handled in 10 and falling back to cosmetic hide in 13. Bundle-at-build-time — Task 6. Newsletter heuristic with its three signals and hard refusals — Task 11. Scroll unlock — Task 12. Per-site pause — Tasks 2, 5, 13. Circuit breaker — Task 13. Popup error surfacing for unenforced settings — Tasks 3, 4, 5. Attribution — Task 1. Testing strategy including negative fixtures — Tasks 11, 12, and the manual checklist in 14.

**Known gaps, deliberate.** `slide`, `runrooted`, and `runmethod` are unimplemented (3% of rules, TrustArc most notably); those rules abandon to cosmetic hiding. The `url` matcher reads `globalThis.location`, so it is inert under jsdom — acceptable, since only 5 rules use it. No end-to-end browser automation; Task 14 covers that ground manually, per the spec's decision not to run CI against live sites.

**Type consistency.** `queryAll(root, target)`, `createMatcher(config).matches(root)`, `createAction(config, ctx).execute(root)`, `runEngine(bundle, root, opts)`, `createSweeper({settings, bundle, root})` are used consistently across Tasks 7–13. `ctx` carries `shouldAllow` throughout. `isPaused(settings, hostname)` takes settings first in both Task 2 and Task 13.

**Revised scope.** ~1,900 LOC against the spec's ~1,620 — the engine measured at ~740 rather than ~450 once the twelve action types were counted against real rule usage. Fourteen tasks, roughly two and a half days.
