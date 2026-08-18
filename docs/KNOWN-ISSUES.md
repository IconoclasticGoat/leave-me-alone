# Known issues

Findings raised during implementation review that were deliberately not fixed. None block the extension from working; all are recorded so they are not rediscovered from scratch.

**The extension has never been run in a real browser.** See [QA.md](QA.md) — that checklist is written but unexecuted, and it is the only verification the `chrome.contentSettings` layer and real-world CMP behaviour will ever get.

## Behavioural gaps

**Pause only covers the DOM layer.** "Pause on this site" stops cookie-banner and newsletter dismissal, but the site still receives `Sec-GPC`, still has one-tap and chat widgets blocked, and still has notifications, location, and camera blocked by `chrome.contentSettings`. Those are set with `primaryPattern: '<all_urls>'`, and extension-set content settings override the user's own per-site grants — so a user who deliberately allowed notifications from their calendar app loses them, with no route back through the site, Chrome settings, or the pause button. Fixing it means writing a per-origin `allow` exception on pause.

**The GPC property is set too late to be read.** `gpc-inject.js` awaits `chrome.storage.sync` before injecting, and the injected `<script src=…>` is async, so `navigator.globalPrivacyControl` lands tens of milliseconds after the page's own head scripts have run. CMPs read GPC at init, so the property half of the signal is likely a no-op in practice. The `Sec-GPC` header — the half that carries legal weight under CCPA/CPRA — is unaffected. A manifest-declared `"world": "MAIN"` content script at `document_start` would fix it, at the cost of not being able to read the toggle.

**The cosmetic fallback misses banners whose only cookie wording sits in a link.** To stop it hiding ordinary page furniture, cookie-word matching is scoped to element prose and excludes `<a>`/`<button>` label text. A banner phrased "By continuing to browse you agree to our [Cookie Policy]" with an Accept button is therefore missed. This is the safe direction — under-hiding never breaks a page — but it is a real gap, not a theoretical one.

**Newsletter heuristic residuals.** A cart drawer carrying both a discount code and an email input is dismissed. Commerce vetoes (`your bag`, `checkout`, `subtotal`) would close it. The heuristic is phrase-based and will never be exhaustive; per-site pause is the designed escape hatch.

**`stripWww` is not a public-suffix list.** Pause strips a leading `www.` only — `m.example.com` and `www2.example.com` are treated as distinct domains. True eTLD+1 needs a PSL, which this zero-dependency build does not carry.

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

- `src/background/index.js` has no tests at all. Deleting the `chrome.storage.onChanged → applyAll()` wiring leaves the suite green, and that line is what makes every toggle take effect.
- The CMP method sequence is unpinned: reducing `ORDER` to `['DO_CONSENT']` passes. On a real site that means categories are unticked but never submitted — the extension appears to do nothing while tests stay green.
- Only 1 of 202 vendored rules (Cookiebot) has an integration fixture.
- The evaluation-time guard in `createMatcher` — a Critical fix during implementation — has no test; deleting it leaves the suite green.
- Popup `init()` is untested: tab query, pause button wiring, error surfacing.
- No error handling anywhere around `chrome.storage.sync` rejections; `pausedSites` can hit `QUOTA_BYTES_PER_ITEM`.

## A note on testing this codebase

Reviews caught the same failure six times: a test asserting exactly the right thing while proving nothing, because its fixture tripped an unrelated condition before reaching the behaviour under test. The cause is structural — this code is a stack of veto guards, and **veto guards mask each other by construction**, so a fixture aimed at one usually fails another first.

A passing test is therefore not evidence that a guard is protected. The reliable check is mutation: delete the guard, run the focused test file, confirm it goes red. That takes about two seconds and found eleven unprotected guards across this branch. Treat it as the merge gate for any change to `src/content/` or `src/engine/`.
