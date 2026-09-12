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
change clears and rewrites all six content-setting types, plus four patterns
per paused domain per type. Fine for a normal paused list; it would need
batching if that list grew into the hundreds.

**The GPC property is set too late to be read.** `gpc-inject.js` awaits `chrome.storage.sync` before injecting, and the injected `<script src=…>` is async, so `navigator.globalPrivacyControl` lands tens of milliseconds after the page's own head scripts have run. CMPs read GPC at init, so the property half of the signal is likely a no-op in practice. The `Sec-GPC` header — the half that carries legal weight under CCPA/CPRA — is unaffected. A manifest-declared `"world": "MAIN"` content script at `document_start` would fix it, at the cost of not being able to read the toggle.

**The cosmetic fallback misses banners whose only cookie wording sits in a link.** To stop it hiding ordinary page furniture, cookie-word matching is scoped to element prose and excludes `<a>`/`<button>` label text. A banner phrased "By continuing to browse you agree to our [Cookie Policy]" with an Accept button is therefore missed. This is the safe direction — under-hiding never breaks a page — but it is a real gap, not a theoretical one.

**An accept control that is a bare `<a>` is not recognised.** The
fallback counts an anchor as a control when it resolves to the same document or
carries a `javascript:` href, which is what reaches drsquatch.com's "OK", and
when it has no href but declares `role="button"`, which is what reaches the
cookieconsent library's "Got it!" on neighborhoodscout.com. An `<a>Accept</a>`
with neither is still ignored: sites use those for layout as often as for
controls, and treating them as consent actions would reopen the nav-bar false
positives the tag restriction was added to prevent. No reported banner has
needed it yet.

**The iframe pass in the cosmetic fallback runs off a hand-written origin
allowlist.** `CMP_FRAME_HOSTS` in `src/content/cosmetic.js` names thirteen
consent-frame origins, and now governs which frames `start()` attaches a
`ResizeObserver` to as well as what the fallback will hide. A CMP that serves its UI from an origin not on that
list is still invisible to both layers, and the list has to be maintained by
hand — nothing in the vendored rule bundle carries frame origins to derive it
from. The alternative, treating any fixed wrapper around any cross-origin
frame as a banner, was rejected: that shape equally describes a Stripe
checkout, a paywall and a video lightbox, and hiding one of those breaks the
page in a way under-hiding never does.

**Newsletter heuristic residuals.** A cart drawer carrying both a discount code and an email input is dismissed. Commerce vetoes (`your bag`, `checkout`, `subtotal`) would close it. The heuristic is phrase-based and will never be exhaustive; per-site pause is the designed escape hatch.

**`stripWww` is not a public-suffix list.** Pause strips a leading `www.` only — `m.example.com` and `www2.example.com` are treated as distinct domains. True eTLD+1 needs a PSL, which this zero-dependency build does not carry. This now governs the `declarativeNetRequest` domain exclusions and the content-setting patterns as well, not just DOM-layer pause.

## Permissions

**`<all_urls>` cannot be narrowed, and narrowing it would buy nothing.** Raised
while preparing the Web Store submission, since broad host access is the single
biggest driver of review scrutiny. Traced to a conclusion, then left alone.

Only two things actually require the host permission:

- **The `Sec-GPC` header rule.** `rules/gpc.json` uses `modifyHeaders`, and
  Chrome requires host permissions for header-modifying and redirecting rules —
  for the request URL, and additionally for the initiator on everything that is
  not a navigation request. The rule's filter is `*`, so that is `<all_urls>`
  by construction. Without it, GPC degrades to the `navigator.globalPrivacyControl`
  property alone, losing the half of the signal that carries legal weight.
- **Reading `tab.url`** in `src/background/index.js` for per-tab icon stamping.
  The alternative is the `tabs` permission, which warns *"Read your browsing
  history"* — not obviously a better trade than the host permission it replaces.

Everything else is already covered without it. `chrome.contentSettings` needs
only the `contentSettings` permission — the `<all_urls>` primary pattern it
writes is an API argument, not a permission requirement — and that accounts for
six of the eleven settings. The one-tap and chat-widget rules are DNR **block**
actions, which need no host access. Content scripts carry their own `matches`.

The decisive point is that removing `host_permissions` would not change the
install prompt at all: Chrome treats `content_scripts.matches` identically to
host permissions when computing warnings, and the content scripts already match
`<all_urls>`. The prompt reads *"Read and change all your data on all
websites"* either way. Narrowing the line would cost the GPC header and save
the user zero words of warning.

The only architecture that genuinely cleans up the prompt is dropping the
static `content_scripts` block, declaring `optional_host_permissions`, and
calling `chrome.permissions.request()` from the popup on first run followed by
`chrome.scripting.registerContentScripts()`. Rejected: it gates an extension
whose entire premise is "works everywhere, automatically" behind a runtime
grant carrying the same warning text, and it adds a whole permission-state
machine — is access granted, was it revoked, are the scripts registered — to
every path that currently just reads a setting.

What *was* taken from this analysis: `declarativeNetRequest` became
`declarativeNetRequestWithHostAccess`. The plain permission adds a separate
*"Block content on any page"* line to the install prompt; the WithHostAccess
form adds none and relies on host permissions this extension already holds. All
three rules keep working. One fewer warning, no functional change.

## Performance

**`dist/content.js` is ~492 KB and injects into every frame.** The 455 KB rule bundle is inlined at build time, and the manifest uses `all_frames: true`. An ad-heavy page with 30 subframes parses roughly 15 MB of script. Options: run the engine only in the top frame; load the bundle via `chrome.runtime.getURL` (an extension-internal URL, so the zero-network-requests promise survives); or hold it in the service worker.

**Every sweep evaluates all 202 rules' detectors** — 207 detectors, 409 selectors, re-run on each debounced mutation for the observer's lifetime, in every frame, until a CMP is handled. A cheap first-pass filter (a combined selector, or sniffing for `__tcfapi` / `OneTrust` / `Cookiebot` globals) before the per-rule loop would cut most of it.

**Sweep scheduling.** `start()` originally disconnected 10s after
`document_idle` regardless of activity, debounced with no max-wait, cleared its
own pending sweep on the way out, and watched only childList records on
`root.body`. All of that is fixed across two passes: the debounce is bounded by
`MAX_WAIT_MS`, `stop()` runs an outstanding sweep rather than discarding it,
allowlisted consent frames get a `ResizeObserver` and a `load` listener, and the
observer now watches the five attributes a reveal goes through as well as
childList.

The quiet deadline is gone entirely. Making it a quiet period rather than a
fixed lifetime was not enough — it still expires on a page that was quiet from
the *start*, which is where late modals live. `natashaskitchen.com` emits zero
mutations of any kind over 10s of scrolling and reveals a Kit signup at ~15s.
`MAX_LIFE_MS` (60s) is now the only bound.

What is still missing:

- **Anything that appears after `MAX_LIFE_MS`.** 60s covers the 15-30s
  newsletter triggers seen so far, but exit-intent and deep-scroll popups can
  fire much later. Watching a silent page is free, so raising this is a
  one-constant change if QA finds later-firing cases; the reason not to make it
  unbounded is pages that genuinely churn, where each sweep still evaluates all
  202 rules.
- **Head insertions.** The observer roots at `root.body`, so a `<style>` or
  `<script>` appended to `<head>` raises nothing. Rooting at `documentElement`
  would cost little.
- **Per-sweep cost is unreduced.** The cheap pre-filter under **Performance**
  was the stated prerequisite for attribute observation. Attribute observation
  landed without it because the measured cost on the sites that needed it was
  zero mutations in 10s; the filter still matters for genuinely busy apps, and
  `attributeFilter` plus `MAX_WAIT_MS` is what stands in for it today.

Absolute reveal timing still needs a real Chrome profile. Headless and preview
browsers suspend rendering in a backgrounded tab, which makes an overlay read
as 0x0 long after it is live — only *ordering* survives that. See
[QA.md](QA.md) Item 6b.

## Correctness details

- `cmp.js` `isPresent`/`isShowing` OR across all detector entries rather than requiring both within one entry. Affects 4 of 202 rules; a false positive falls through to the cosmetic fallback rather than breaking anything.
- **`queryAll` silently ignores `iframeFilter`.** It appears on 9 targets
  across the bundle and is dropped, so those selectors match against the
  current document rather than searching into a frame. Unlike
  `childFilterNegate` this only widens a match rather than inverting it, and
  honouring it properly is bounded by the same-origin policy — a cross-origin
  consent frame cannot be queried from the host at all, which is why the
  cosmetic fallback handles those from the outside instead.
- The `Promise.race` timeout in `runEngine` never clears its `setTimeout`, leaving one ~8 s timer per matched CMP per page load.
- `state.handled` never resets, so SPA route changes get no second pass.
- `createSweeper`'s `start()` is non-reentrant; `stop()` before `start()` is a silent no-op.
- `rules/gpc.json` sets `Sec-GPC` only on `main_frame`, `sub_frame`, and `xmlhttprequest` — not images, scripts, stylesheets, beacons, or websockets.
- `rules/one-tap.json` blocks only `accounts.google.com/gsi/iframe/select` (the One Tap prompt card iframe, `gsi/client`'s `prompt_url`). It no longer blocks the whole `gsi/` path, which had also taken out the `gsi/client` library and the `gsi/button` iframe and so broke the ordinary "Sign in with Google" button (reported on claude.ai). The FedCM-mediated One Tap prompt (`gsi/fedcm/config/passive`) is browser-native and not covered.
- `rules/chat-widgets.json` blocks `static.zdassets.com`, which serves Zendesk Help Center assets generally, not just chat.
- `manifest.json` has no `minimum_chrome_version` despite `contentSettings.sound` requiring Chrome 141+.
- `web_accessible_resources` lacks `use_dynamic_url: true`, so any page can probe for `gpc-main.js` and fingerprint the extension.

## Test coverage gaps

- `src/background/index.js` is only partly tested. `test/background.test.js` covers the scheduler and the `chrome.storage.onChanged → schedule()` wiring; the `tabs.onUpdated` / `tabs.onActivated` stamping listeners still have no test.
- The CMP method sequence is unpinned: reducing `ORDER` to `['DO_CONSENT']` passes. On a real site that means categories are unticked but never submitted — the extension appears to do nothing while tests stay green.
- Only 2 of 203 bundled rules (Cookiebot, and the local cookieconsent rule) have an integration fixture.
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
