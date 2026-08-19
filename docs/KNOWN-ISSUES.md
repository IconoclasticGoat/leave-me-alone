# Known issues

Findings raised during implementation review that were deliberately not fixed. None block the extension from working; all are recorded so they are not rediscovered from scratch.

## Behavioural gaps

**Pausing a site writes `ask`, which is not the user's own preference.**
While a toggle is on, the extension holds `<all_urls>` → `block` for that
content-setting type, and a paused site needs a more specific pattern to
outrank it. Chrome offers no way to write "nothing" at a narrower pattern, so
the exception has to be an actual value: `ask`. Extension-set content settings
sit above the user's own layer, so someone who had deliberately allowed
notifications for a site and then pauses it gets `ask`, not their original
grant. The site can prompt again and the user can re-grant, but it is not a
true restore, and no API offers one.

This applies only to the paused-site exception. A toggle that is simply **off**
writes nothing at all — `clear()` returns the type to the user's own settings,
which is a true restore.

**Pausing a site permits popups on that site.** `popups` accepts only
`allow`/`block`, so its paused exception can only be `allow` — there is no
`ask` to fall back to. `sound` is the same, and `cookies` releases to `allow`
rather than `session_only`. Pause means "behave as the site intends", and for
these three that is the literal effect: a paused site may open popups the
extension would otherwise have blocked.

**`applyAll` runs are serialised, not atomic.** `chrome.storage.onChanged`
fires once per write, so rapid toggling queues several full reconciliations.
The queue in `src/background/index.js` stops them interleaving, but each run
still leaves a brief window in which a type has been cleared and not yet
rewritten, and a queued run reads settings when it starts rather than when it
was scheduled.

**Toolbar signalling is invisible when the extension is unpinned.** An
extension living in the puzzle-piece overflow menu shows neither its icon
state nor a badge. The popup's paused banner is the only signal those users
get.

**Content-setting reconciliation is O(types x paused sites).** Every settings
change clears and rewrites all eight content-setting types, plus four patterns
per paused domain per type. Fine for a normal paused list; it would need
batching if that list grew into the hundreds.

**The GPC property is set too late to be read.** `gpc-inject.js` awaits `chrome.storage.sync` before injecting, and the injected `<script src=…>` is async, so `navigator.globalPrivacyControl` lands tens of milliseconds after the page's own head scripts have run. CMPs read GPC at init, so the property half of the signal is likely a no-op in practice. The `Sec-GPC` header — the half that carries legal weight under CCPA/CPRA — is unaffected. A manifest-declared `"world": "MAIN"` content script at `document_start` would fix it, at the cost of not being able to read the toggle.

**The cosmetic fallback misses banners whose only cookie wording sits in a link.** To stop it hiding ordinary page furniture, cookie-word matching is scoped to element prose and excludes `<a>`/`<button>` label text. A banner phrased "By continuing to browse you agree to our [Cookie Policy]" with an Accept button is therefore missed. This is the safe direction — under-hiding never breaks a page — but it is a real gap, not a theoretical one.

**`target.parent` is ignored, so consent toggles are matched page-wide.** 530
`parent` blocks across 61 rules scope a selector to an ancestor — typically
"the `.category-item` whose header reads *Performance Cookies*". `queryAll`
never reads the field, so such a target resolves against the whole document
and takes the *first* match anywhere. Where a preference centre lists several
categories with identical inner markup, a per-category read or toggle can
land on the wrong category. It did not block investing.com — that panel uses
the newer `.ot-cat-item` markup and ships every switch already off — but it
will misfire on a panel that defaults a category on.

**Newsletter heuristic residuals.** A cart drawer carrying both a discount code and an email input is dismissed. Commerce vetoes (`your bag`, `checkout`, `subtotal`) would close it. The heuristic is phrase-based and will never be exhaustive; per-site pause is the designed escape hatch.

**`stripWww` is not a public-suffix list.** Pause strips a leading `www.` only — `m.example.com` and `www2.example.com` are treated as distinct domains. True eTLD+1 needs a PSL, which this zero-dependency build does not carry. This now governs the `declarativeNetRequest` domain exclusions and the content-setting patterns as well, not just DOM-layer pause.

## Performance

**`dist/content.js` is ~492 KB and injects into every frame.** The 455 KB rule bundle is inlined at build time, and the manifest uses `all_frames: true`. An ad-heavy page with 30 subframes parses roughly 15 MB of script. Options: run the engine only in the top frame; load the bundle via `chrome.runtime.getURL` (an extension-internal URL, so the zero-network-requests promise survives); or hold it in the service worker.

**Every sweep evaluates all 202 rules' detectors** — 207 detectors, 409 selectors, re-run on each debounced mutation for the observer's lifetime, in every frame, until a CMP is handled. A cheap first-pass filter (a combined selector, or sniffing for `__tcfapi` / `OneTrust` / `Cookiebot` globals) before the per-rule loop would cut most of it.

**`QUIET_MS` is a fixed lifetime, not a quiet period.** The observer disconnects 10 s after `document_idle` regardless of page activity, so late-injecting CMPs — OneTrust and Sourcepoint routinely wait on a network round trip — are never seen. Either reset the timer on each mutation or rename the constant and raise it.

## Correctness details

- `cmp.js` `isPresent`/`isShowing` OR across all detector entries rather than requiring both within one entry. Affects 4 of 202 rules; a false positive falls through to the cosmetic fallback rather than breaking anything.
- The `Promise.race` timeout in `runEngine` never clears its `setTimeout`, leaving one ~8 s timer per matched CMP per page load.
- `state.handled` never resets, so SPA route changes get no second pass.
- `createSweeper`'s `start()` is non-reentrant; `stop()` before `start()` is a silent no-op.
- `rules/gpc.json` sets `Sec-GPC` only on `main_frame`, `sub_frame`, and `xmlhttprequest` — not images, scripts, stylesheets, beacons, or websockets.
- `rules/one-tap.json` blocks `accounts.google.com/gsi/`, which disables the ordinary "Sign in with Google" button as well as one-tap. The toggle label undersells this.
- `rules/chat-widgets.json` blocks `static.zdassets.com`, which serves Zendesk Help Center assets generally, not just chat.
- `manifest.json` has no `minimum_chrome_version` despite `contentSettings.sound` requiring Chrome 141+.
- `web_accessible_resources` lacks `use_dynamic_url: true`, so any page can probe for `gpc-main.js` and fingerprint the extension.

## Test coverage gaps

- `src/background/index.js` is only partly tested. `test/background.test.js` covers the scheduler and the `chrome.storage.onChanged → schedule()` wiring; the `tabs.onUpdated` / `tabs.onActivated` stamping listeners still have no test.
- The CMP method sequence is unpinned: reducing `ORDER` to `['DO_CONSENT']` passes. On a real site that means categories are unticked but never submitted — the extension appears to do nothing while tests stay green.
- Only 1 of 202 vendored rules (Cookiebot) has an integration fixture.
- The evaluation-time guard in `createMatcher` — a Critical fix during implementation — has no test; deleting it leaves the suite green.
- `declarativeNetRequest`'s `excludedRequestDomains` has never been given a
  bare-IP paused host in a real browser. `patternsFor` now skips the patterns
  Chrome rejects for an address literal, so the content-settings layer is
  clean, but the DNR layer is only ever exercised against a stub. If Chrome
  rejects an IP there, `updateDynamicRules` fails *atomically* and the
  previous dynamic rules freeze in place — the same failure mode `HOSTNAME_RE`
  was written to prevent. See the bare-IP items in [QA.md](QA.md) Section 7.
- No error handling anywhere around `chrome.storage.sync` rejections; `pausedSites` can hit `QUOTA_BYTES_PER_ITEM`.

## A note on testing this codebase

Reviews caught the same failure six times: a test asserting exactly the right thing while proving nothing, because its fixture tripped an unrelated condition before reaching the behaviour under test. The cause is structural — this code is a stack of veto guards, and **veto guards mask each other by construction**, so a fixture aimed at one usually fails another first.

A passing test is therefore not evidence that a guard is protected. The reliable check is mutation: delete the guard, run the focused test file, confirm it goes red. That takes about two seconds and found eleven unprotected guards across this branch. Treat it as the merge gate for any change to `src/content/` or `src/engine/`.
