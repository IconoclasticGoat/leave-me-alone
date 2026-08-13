# leave-me-alone — Design

**Date:** 2026-08-13
**Status:** Approved, ready for implementation planning

## Motivation

From [a Bluesky post by Helen Barnard](https://bsky.app/profile/helenbarnard.bsky.social/post/3msv2feu6cc2i):

> "But why can't I just have a google setting that just automatically tells every website I visit: Only necessary cookies / Block notifications / I don't want to sign up to any newsletters? Surely that should be possible."

A Chrome extension (Manifest V3) with a small panel of toggles that enforce these preferences everywhere, plus blocking location requests by default.

## Honest framing

Half of this is packaging, not invention. Chrome already exposes notification, location, camera, microphone, sound, popup, and download defaults through `chrome.contentSettings` — and through its own Settings UI. The value added is one panel with a few switches instead of preferences buried across several menus, which is precisely the complaint. The other half — cookie banners and newsletter modals — has no API and is genuinely hard.

## Architecture: three enforcement layers

Every toggle maps to exactly one mechanism. Holding this boundary is what keeps the codebase small and debuggable.

| Layer | Mechanism | Toggles served |
|---|---|---|
| Chrome-native | `chrome.contentSettings` | notifications, location, camera/mic, sound, popups, auto-downloads, session-only cookies |
| Network | static `declarativeNetRequest` rulesets | GPC header, Google one-tap, chat-widget domains |
| DOM | content script | cookie banners, newsletter modals |

### Components

- **Settings store** — a single flat object of booleans in `chrome.storage.sync`, plus `pausedSites: string[]`. Single source of truth.
- **Popup** — reads and writes the settings object. No logic beyond that.
- **Service worker** — reacts to settings changes by calling `contentSettings.*.set()` and `declarativeNetRequest.updateEnabledRulesets()`. Also applies settings on `runtime.onInstalled`. Does no per-navigation work.
- **Content script** — cookie banners and newsletter modals. The only component with real complexity.
- **Rule bundle** — vendored Consent-O-Matic rules, built into one versioned JSON.

Content settings are applied once when a toggle flips, not on every page load. This keeps the service worker almost entirely idle.

## Toggles

Four primary, matching the original complaint. The rest live behind a collapsed "More" section so the panel still reads as simple.

**Primary:** cookie banners · notifications · location · newsletter popups

**More, on by default:** Global Privacy Control · camera & microphone · popups & auto-downloads · autoplay sound

**More, off by default:** hide chat bubbles · block Google one-tap · session-only cookies

### Global Privacy Control

`Sec-GPC: 1` on every request via a DNR header rule, plus `navigator.globalPrivacyControl` in the page. Legally binding under CCPA/CPRA and in Colorado and Connecticut — sites that honor it must not sell or share personal data, with no click required. It is the closest real-world thing to the "one global setting" the post asks for, and it costs one rule.

### Session-only cookies

Off by default. `contentSettings.cookies → session_only` deletes all cookies when Chrome quits, which is the bluntest form of "only necessary cookies" — it does not ask sites to behave, it discards what they stored. It also logs the user out of every site on every restart. The toggle carries an explicit warning to that effect.

## Content script

Runs at `document_idle` in all frames, with a debounced `MutationObserver` because banners routinely appear two to five seconds after load. The observer disconnects after roughly ten seconds of quiet so it is not a permanent CPU cost.

Each pass, in order:

1. **CMP match** — fingerprint against the rule bundle's detectors (`presentMatcher` / `showingMatcher`); on match, run that rule.
2. **Cosmetic fallback** — no rule matched, but a fixed or sticky element contains cookie-ish text: hide it.
3. **Newsletter heuristic** — see below.
4. **Scroll unlock** — after any dismissal, strip `overflow: hidden` from `body` and `html`.

### Rule engine

Reads Consent-O-Matic's rule format (MIT licensed). Supported actions: `click`, `list`, `consent`, `hide`, `waitcss`, `foreach`, `close`. Supported matchers: `css`, `checkbox`. Methods: `OPEN_OPTIONS`, `DO_CONSENT`, `SAVE_CONSENT`, `HIDE_CMP`, `UTILITY`.

Simplification: Consent-O-Matic supports arbitrary per-category consent profiles. We only ever want one — necessary on, every other category off — so `DO_CONSENT` collapses to a constant rather than a user-configurable matrix. This removes the need to map TCF letter codes (A, B, D, E, F) to user-facing labels.

Graceful degradation: a rule using an unimplemented action is abandoned, and the element falls through to the cosmetic-hide path. Partial engine support costs coverage, never correctness.

### Rule bundle and updates

The Consent-O-Matic repository ships 204 rule files covering 203 consent platforms — 2.2 MB raw, merging to a **454 KB minified bundle**. A build script fetches them, strips the `$schema` keys, merges, and minifies into a single versioned JSON shipped inside the extension. Refreshing rules is a documented command, not a code change. MIT attribution goes in `THIRD_PARTY.md` and the store listing.

**Rules are bundled at build time, never fetched at runtime.** Consent-O-Matic itself does the opposite: `rules-list.json` is a manifest of `raw.githubusercontent.com` URLs that its extension fetches live, so rules stay current without a release. We deliberately do not follow them, for two reasons.

First, the privacy claim. This extension's entire pitch is *leave me alone*; "makes zero network requests of its own" is a stronger and more honest promise than rule freshness is a benefit. An extension that phones a server to help you avoid being tracked invites exactly the question we do not want to answer.

Second, review risk. MV3 policy prohibits remotely-hosted code. A declarative rule DSL is data rather than code, but one that drives clicks on a page sits close enough to the boundary to invite review friction, and store review is the slowest loop in this project.

The cost is staleness: rules only update when a new version ships. This is acceptable because the largest platforms — OneTrust, Cookiebot, Didomi, Usercentrics, Quantcast — change rarely, and a rule bundle a few months old still handles the overwhelming majority of banners. If staleness proves painful in practice, the escape hatch is a manual "update rules now" button rather than automatic background fetching, which keeps the network request user-initiated and explicit.

### Newsletter heuristic

Deliberately conservative. Requires all three signals:

- overlay positioning (fixed or absolute, high z-index)
- an email input
- subscribe-ish text content

And refuses outright if the element contains a password field or more than two inputs. Login modals, age gates, and cart drawers survive. False positives are the main way extensions of this kind earn one-star reviews, so the heuristic errs toward inaction.

### Safety valves

- **Pause on this site** — one click in the popup, stored in `pausedSites`, applied per registrable domain.
- **Per-step isolation** — every action is individually try/caught with a timeout.
- **Session circuit breaker** — a rule that throws twice on a domain is disabled there for the rest of the session.

The extension must never be the reason a page breaks. When uncertain, it does nothing.

### No dismissal notifications

The extension is silent when it dismisses something. No toast, no injected UI. If a site misbehaves, the user pauses it from the toolbar. A popup-blocker that shows popups is self-defeating, and the injected-UI code (shadow root, positioning, style isolation) is not worth its weight.

## Error handling

Content-script failures are contained per step and never propagate to the page. Service-worker failures on `contentSettings.set()` are surfaced in the popup as a per-toggle error state rather than failing silently — a toggle that appears on but is not enforced is worse than one that admits it failed.

## Testing

- **Unit tests (vitest + jsdom)** — the rule engine against saved HTML fixtures of real CMP banners. Snapshot a banner once, assert the rule finds and clicks reject. This is what makes later refactoring safe.
- **Newsletter classifier tests** — positive fixtures alongside negatives (login modal, cart drawer, cookie banner), asserting the negatives are left alone.
- **Manual QA checklist** — the `contentSettings` layer. It cannot be meaningfully tested headlessly and amounts to about eight one-line calls.
- **No CI against live sites.** Real pages change; that build would be permanently red.

## Scope estimate

| Piece | Size |
|---|---|
| Scaffold, manifest, storage, service worker | ~150 LOC |
| Popup UI | ~200 LOC |
| contentSettings layer | ~80 LOC |
| DNR rulesets (GPC, one-tap, chat widgets) | ~70 LOC + JSON |
| Content script core, observer, scroll unlock | ~200 LOC |
| Consent-O-Matic rule engine | ~450 LOC |
| Rule bundle build script | ~20 LOC |
| Cookie cosmetic fallback + newsletter heuristic | ~150 LOC |
| Tests + fixtures | ~300 LOC |

**~1,620 LOC**, of which ~300 is tests and ~1,320 is shipping code. Plus a 454 KB vendored rule bundle, which is data and costs no maintenance beyond re-running the build.

Roughly two focused days to a tested, working unpacked extension. Real-site QA and rule tuning is open-ended — the first pass over twenty or so heavily-annoying sites is half a day, and after that it is as much as you care to invest. Chrome Web Store submission — icons, screenshots, privacy policy, review wait — is a separate half-day of mostly paperwork.

**Ongoing:** re-running the rule bundle build periodically. Because rules are vendored data rather than hand-written code, maintenance is a command rather than an investigation.

## Explicitly out of scope

- Anti-adblock and paywall circumvention — adversarial, and it changes what the extension is.
- Per-category consent preferences — we always reject everything non-necessary.
- Firefox and Safari ports.
- Any remote server, and any runtime fetching of rules. The extension makes no network requests of its own and collects no data. See "Rule bundle and updates."

## Decisions taken

| Decision | Choice | Rationale |
|---|---|---|
| Session-only cookies default | Off | Surprise logout on every restart would drive uninstalls |
| Dismissal feedback | Silent, per-site pause only | Silence is the product; injected UI is not worth its cost |
| Cookie rule source | Consent-O-Matic rules (MIT), own engine | Rules are the valuable, rot-prone part; let upstream maintain them |
| Cookie banner strategy | Reject via rules, cosmetic hide as fallback | Broad coverage without a bespoke rule treadmill |
| Rule delivery | Bundled at build time, never fetched at runtime | Preserves the zero-network-requests claim; avoids MV3 remote-code review risk |
