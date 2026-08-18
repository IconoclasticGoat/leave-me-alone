# Pause signaling — Design

**Date:** 2026-08-18
**Status:** Approved, ready for implementation planning

## Motivation

When the extension is paused on a site, nothing says so. The only cue is the popup's bottom button flipping from `Pause on example.com` to `Resume on example.com` ([popup/popup.js:63](../../../popup/popup.js)) — below the toggle list, easy to miss, and invisible unless you open the popup at all.

Two problems block a straightforward fix.

**There is no icon.** [manifest.json](../../../manifest.json) declares no `icons` and no `action.default_icon`, so Chrome renders its grey letter placeholder. "Change the icon when paused" presupposes an icon to change.

**Pause doesn't do what a paused signal would claim.** It suspends only the DOM layer ([src/content/index.js:76](../../../src/content/index.js)). A paused site still receives `Sec-GPC`, still has one-tap and chat widgets blocked by `declarativeNetRequest`, and still has notifications, location, and camera blocked by `chrome.contentSettings`. Signaling "off" against that behaviour would be a lie.

This design fixes the second problem so the first can be solved honestly: pause is widened to cover every enforcement layer, and then signalled in the toolbar and the popup.

## Scope

In scope: widening pause across all three enforcement layers; an icon set with active and paused variants; per-tab icon and tooltip; a paused state for the popup.

Out of scope: a list of paused sites in the popup for un-pausing a site you are not currently on. Real gap, separate change.

## Design decisions

| Decision | Choice | Why |
|---|---|---|
| Pause scope | Widen to all three layers | A signal that overstates what pause does is worse than no signal |
| Content setting on a paused site | `ask` | Restores prompting without granting access the user never approved |
| Content setting when a toggle is off | Write nothing | `clear()` hands the type back to the user's own settings; any value we write outranks theirs |
| Icon concept | Do-not-disturb disc | Densest, most legible mark at 16px |
| Paused variant | Bar rotated 30° about centre | Shape difference, not colour alone; survives greyscale and colourblindness |
| Badge | None | The icon carries the signal; a badge obscures it and stays free for a future counter |
| Popup treatment | Banner strip | State where the eye lands first, without hiding the settings |
| Icon pipeline | SVG source, rasterised by a devDependency | The only option where the icon has an editable source of truth |

### Why 30°, and why not more

Below ~18° a tilt reads as an export error rather than a state, and is indistinguishable from 0° at 16px. At 45° a circle with a bar through it *is* the universal prohibited sign — the paused icon would read as more forbidding than the active one, inverting the message. 30° is the strongest small-size signal that stays clear of that ceiling.

### Why `ask` and not `allow` — and only for a paused site

This applies to **one** case: a paused domain under a global block that is still active. The extension has written `<all_urls>` → `block`, and the paused site needs a pattern that outranks it. Chrome offers no way to remove a single content-setting pattern (`clear()` wipes everything the extension set for a type), so the exception must *write* a value. `allow` would hand the site a permission the user never granted. `ask` returns the decision to the user through Chrome's own dialog.

Three types have no `ask` state and fall back to `allow`: `popups` and `sound` accept only `allow`/`block`, and `cookies` accepts `allow`/`block`/`session_only`. Sending them `ask` throws, which would land in `lastApplyErrors` rather than being enforced. So pausing a site does *permit popups* on that site — there is no third value to write.

### Why a toggle that is off writes nothing at all

The reasoning above does **not** extend to the toggle-off case, and an earlier draft of this spec over-applied it. Once reconciliation calls `clear()` first, a toggle that is off has nothing to outrank: `clear()` alone already returns the type to the user's own layer, which is exactly the outcome wanted. Writing a release value there is not "stepping aside", it is putting the extension's preference above the user's — extension-set content settings sit above the user's own.

For two types that inverts the product. `cookies` releases to `allow`, and `sessionOnlyCookies` is **off by default**, so a stock install would have handed every site a blanket cookie `allow` outranking the user's own cookie preferences. `popups` also releases to `allow`, and Chrome's own default for popups is *block*, so turning off "Block popups & automatic downloads" would leave the browser weaker than if the extension had never been installed.

So: toggle on → `clear()`, then write the block and the paused exceptions. Toggle off → `clear()` and stop. `releaseValueFor` survives, used only for the paused exceptions.

## Architecture

The three enforcement layers from the original design are unchanged. Each gains a per-site exemption.

### Content settings

`applyContentSettings` becomes a full reconciliation, because there is no per-pattern removal:

1. `clear()` each mapped type.
2. If the toggle is **off**, stop there — the user's own settings govern.
3. Otherwise write `<all_urls>` → `block` (`session_only` for `cookies`).
4. For each paused domain, write a more specific pattern → `ask` (`allow` for `popups`, `sound`, and `cookies`).

Each per-domain write carries its own `try`/`catch`. Sharing one with the type would mean a single pattern Chrome's match-pattern parser rejects — an IP literal, a trailing-dot host — silently dropping the exemptions for every domain after it while the global block stayed in force, so the icon would claim "paused" on a site still being blocked. Failures are recorded and the loop continues.

More specific patterns take precedence over `<all_urls>`, so the paused site's rule wins. Patterns are written for both `http` and `https` against `*.<domain>`; the exact subdomain semantics of Chrome's content-setting patterns are a QA item.

Reconciliation runs only on settings change, and leaves a brief window where nothing is enforced. Acceptable at that frequency.

Existing per-type error collection is preserved — failures still reach `lastApplyErrors` so the popup can never claim enforcement it didn't get.

### Network rules

The three static rulesets become dynamic rules, rebuilt on each apply via `updateDynamicRules` with fixed rule ids. Each carries `excludedInitiatorDomains` and `excludedRequestDomains` set to the paused list. Those fields match subdomains automatically, matching `isPaused` semantics.

`excludedRequestDomains` covers main-frame requests, which have no initiator; `excludedInitiatorDomains` covers subresources issued by a paused page.

Both keys must be **omitted**, not passed as empty arrays, when nothing is paused — `declarativeNetRequest` rejects empty arrays. The `rule_resources` block leaves the manifest; the JSON files remain the source of the rule bodies.

### GPC

[gpc-inject.js](../../../src/content/gpc-inject.js) gains the `isPaused(settings, location.hostname)` guard that [content/index.js](../../../src/content/index.js) already has, so `navigator.globalPrivacyControl` is not set on a paused site.

### Toolbar action

New module `src/background/action.js`, with one job: stamp a tab's icon and title from its hostname.

- **Inputs:** a tab id and url, plus settings.
- **Behaviour:** paused host → paused icon and `Leave Me Alone — paused on <host>`; otherwise active icon and the default title. A url that yields no usable hostname (`chrome://`, new tab) falls through to the default, which is the active icon.
- **Triggers:** `tabs.onUpdated`, `tabs.onActivated`, `storage.onChanged`, `runtime.onInstalled`, `runtime.onStartup`.
- **Permissions:** none added. `<all_urls>` already makes `tab.url` readable — the popup depends on this today.

The default action icon is the active variant, so a tab that has never been stamped looks active rather than blank.

### Icons

`assets/icon.svg` holds the active mark. `scripts/build-icons.mjs` rasterises both states at 16/32/48/128 via `@resvg/resvg-js`, a devDependency alongside esbuild, vitest, and jsdom. The shipped extension keeps zero runtime dependencies.

Generated PNGs are committed, so `npm run build` never needs the rasteriser. `npm run icons` regenerates them.

**Single palette for both toolbar themes.** MV3 exposes no signal about toolbar theme, so light and dark variants cannot be shipped as a pair — one tint must serve both. Starting point is a mid indigo around `#5b60d6`; QA confirms it clears contrast on both Chrome toolbar shades. The paused grey already works on both.

### Popup

- Active icon in the `h1`, on every site. Without it the paused popup is the only one carrying an icon, which makes the icon read as a warning rather than a status.
- On a paused site: a banner below the title with the 26px paused icon, **Paused on example.com**, and the line *"Nothing is being blocked here. Cookie banners, prompts, and trackers all behave as the site intends."*
- Primary **Resume on example.com** button with `.75rem` above and below, so it reads as its own band rather than leaning on the toggle list.
- Toggles below carry the real `disabled` attribute, not just dimming — they have no effect on a paused site, and `disabled` gives assistive technology the same information the dimming gives everyone else. `renderToggles` takes a `disabled` flag.

## Testing

Existing suite is 135 unit tests under vitest with jsdom. New coverage:

- **content-settings** — paused domains produce per-origin `ask` writes; a toggle that is off clears its type and writes nothing (asserted for `cookies` and `popups` specifically); `popups`, `sound`, and `cookies` fall back to `allow` for the paused exception; one rejected per-domain pattern does not drop the domains after it; per-type failures still reach `lastApplyErrors`; reconciliation clears before writing.
- **rulesets** — dynamic rules carry both exclusion keys when sites are paused, omit them when none are; rule ids stay stable across rebuilds.
- **gpc-inject** — returns null on a paused host, injects otherwise.
- **action** — icon and title selected per tab from hostname, including subdomain matching; opaque and unparseable urls fall through to the active default.
- **popup** — banner renders on a paused site, toggles carry `disabled`, Resume wiring calls `unpauseSite`.

The icon build script is not unit tested; its output is verified by QA against a real toolbar.

## Known limits

Both belong in [docs/KNOWN-ISSUES.md](../../KNOWN-ISSUES.md) once implemented. The existing entry about pause covering only the DOM layer is resolved by this change and should be rewritten rather than deleted.

**`ask` restores prompting, not the user's own choice.** Extension-set content settings sit above the user's layer. Someone who deliberately allowed notifications for their calendar app and then pauses that site gets `ask`, not their original grant. This is a real improvement on today, where extension settings override user grants with no route back at all — the site can prompt again and the user can re-grant — but it is not a true restore, and no API makes one possible.

**Pausing a site permits popups there.** `popups` accepts only `allow`/`block`, so the paused exception can only be `allow` — the same is true of `sound`, and of `cookies`, whose exception is `allow` rather than `session_only`. Pause is defined as "behave as the site intends", and for these three that is the literal effect.

**`applyAll` runs are serialised through a promise queue, not made atomic.** `chrome.storage.onChanged` fires per write, and reconciliation is now hundreds of awaited calls wide, so concurrent runs would interleave and the last writer would win per type. The queue in [background/index.js](../../../src/background/index.js) removes the interleaving; it does not remove the window in which a type is cleared but not yet rewritten, and a queued run still reads settings at the moment it starts rather than when it was scheduled.

**Toolbar signalling is invisible when unpinned.** An extension in the puzzle-piece overflow menu shows neither icon state nor badge. This is why the popup treatment carries weight independently of the icon work.

**Pause still keys off a `www.`-stripped hostname, not a public suffix list.** Unchanged by this design, and it now governs the network-rule exclusions too, so `m.example.com` and `www2.example.com` remain distinct domains.

**A hostname must look like a DNS name before it can be paused.** `new URL()` does not treat `*` as a forbidden host code point, so a tab left on `http://*.com/` by a failed navigation parses to the hostname `*.com`. Stored, that would emit the match pattern `http://*.com/*` — exempting every `.com` site from every layer — and Chrome would reject `*.com` in `excludedRequestDomains`, failing the whole `updateDynamicRules` call atomically. `pauseSite` therefore validates against a plain DNS-name regex and refuses anything else without storing it, and the popup hides the pause button for such a host via `isPausableHost`, the way it already hides it for a url it cannot parse. Single-label hosts (`localhost`) and IPv6 literals are refused by the same rule.

## Rejected alternatives

| Alternative | Why not |
|---|---|
| Injected page banner or toast | Breaks the silence principle from the original design; a popup-blocker that shows popups is self-defeating |
| Signal honestly against today's partial pause | "Partially paused" is not drawable at 16px, and leaves the content-settings bug unfixed |
| Ship the signal now, widen pause later | Knowingly overstates behaviour for an interim of unknown length |
| Greyscale-only paused icon | Colour alone fails colourblind users and monochrome rendering |
| Badge alongside the changed icon | Obscures the icon at the size where it is already hardest to read; spends the badge slot |
| Runtime `OffscreenCanvas` icon drawing | Removes only the toolbar half of the problem — the manifest still needs PNGs |
| Hand-authored PNGs, no pipeline | No source of truth; every future change is a redraw |
