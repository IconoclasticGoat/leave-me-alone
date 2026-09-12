# Manual QA Checklist

**Status: PARTIALLY RUN.** A manual pass was made against a real Chrome
profile before the Web Store submission. Item 3b was executed and is recorded
as resolved below, as is Item 13 — that one automated, against a real Chromium
rather than by hand. Items still showing an unchecked box have not been
individually signed off here and should not be read as verified.

---

## Why manual testing?

The `chrome.contentSettings` layer — which enforces the actual browser-level privacy settings (notifications, location, camera, microphone, sound, cookies) — cannot be tested headlessly or in unit tests. Additionally, real-world consent-management platform (CMP) behavior is vendor-specific and evolves frequently. This checklist documents the verification that must occur in a real Chrome profile against live websites. Unit tests cover the rule engine, heuristics, and decision logic; this checklist covers whether those decisions actually work in the browser.

---

## Setup

Before running any item below:

- Build the extension: `npm install && npm run build`
- Load unpacked from `dist/` via `chrome://extensions` with Developer mode on
- Ensure all toggles in the popup are visible and functional
- Open the popup when a test requires toggling

---

## Section 1: Chrome Content Settings (Notifications, Location, Camera, Microphone, Sound)

These tests verify that toggling the extension's controls correctly updates the browser's underlying `chrome.contentSettings` API, and that those settings persist across browser restarts.

### Item 1: Notifications setting

- [x] **Test:** Load unpacked from `dist/`. Navigate to `chrome://settings/content/notifications`. Before opening the popup, confirm the setting shows "Don't allow sites to send notifications."
- [x] **Expected result:** The setting is already restricted because the extension sets it on load with the default toggle state.

### Item 2: Notifications toggle

- [x] **Test:** Open the extension popup with notifications **on** (the default). Reload `chrome://settings/content/notifications` and read the state. Then toggle notifications **off** in the popup and reload the settings page again.
- [x] **Expected result:**
  - Toggle **on**: the page reads "Don't allow sites to send notifications" and carries Chrome's "controlled by an extension" banner. The extension writes `block`.
  - Toggle **off**: the banner is gone and there is no extension-controlled entry at all. Whatever the user had chosen in their own Chrome settings is back in force.
  - Off does **not** mean "Allow sites to send notifications". Off means the extension stops writing anything for this type — it never grants a permission on the user's behalf. See Item 9b, which checks this from the other direction.

### Item 3: Other content settings (Location, Camera, Microphone, Sound)

- [ ] **Test:** Repeat the pattern from Item 2 for each setting — turn the toggle on, read the settings page, turn it off, read it again:
  - Location: `chrome://settings/content/location`
  - Camera: `chrome://settings/content/camera`
  - Microphone: `chrome://settings/content/microphone`
  - Sound: `chrome://settings/content/sound` (Chrome 141+ only; on older versions, the popup should surface this as unenforced)

- [ ] **Expected result:** Turning a toggle **on** puts each corresponding type into its blocking state, shown under the "controlled by an extension" banner. Turning it **off** removes the extension's entry entirely: the banner disappears and the type returns to the user's own setting. No toggle ever flips the browser to "Allow". The browser UI reflects every change immediately or on reload.

### Item 3b: What blocking sound actually blocks — RESOLVED: FULL MUTE

The toggle was labelled "Block autoplaying sound", but it writes Chrome's
`sound` content setting, the same control as "Don't allow sites to play sound"
in Chrome's own site settings. That wording is broader than the label was, and
the answer decided whether the setting was safe to ship on by default.

- [x] **Test:** On Chrome 141 or later, turn the sound toggle on. Open
      a video site (YouTube is the case that matters). Let a video load without
      touching it, then press play yourself and unmute if needed.
- [x] **Result: it is a full mute.** A blocked site stays silent even when the
      user presses play themselves. The label "Block autoplaying sound" was
      describing a narrower thing than the setting does.
- [x] **Actions taken:** the toggle keeps its off-by-default state and is now
      labelled **"Mute all sites"**, carrying the warning "Sites stay silent
      even when you press play." The bullet in `docs/STORE-LISTING.md` and its
      `contentSettings` justification were updated to match, and the
      pending-QA note in `src/settings.js` was replaced with this finding.

Superseded, kept for the record — the branch not taken:

- ~~**If only automatic playback is suppressed:** the label is accurate and~~
      the toggle can move back to on-by-default. Moving it means moving its row in
      `TOGGLE_GROUPS.more` too, which `test/popup.test.js` enforces.

### Item 3c: Retired popups & automatic-downloads cleanup on upgrade

The removed "Block popups & automatic downloads" toggle set Chrome's `popups`
and `automaticDownloads` types to `block`. Chrome keeps an extension's
content-setting value across an upgrade, so an install that had that toggle
**on** would stay blocked — unable to take a second download from a site —
unless the new version clears it. `applyContentSettings` clears both types on
every apply (`RETIRED` in `src/background/content-settings.js`), and
`onInstalled` fires that apply on update. Unit-tested; this confirms it in a
real profile.

- [ ] **Test:** On a profile running the **previous** published version, turn
      "Block popups & automatic downloads" on, then confirm
      `chrome://settings/content/automaticDownloads` shows the
      extension-controlled block. Now load this version over it (or bump the
      manifest version and reload the unpacked build to fire `onInstalled`).
      Reload the settings page.
      **Expect:** the "controlled by an extension" banner is gone from both
      `automaticDownloads` and `popups`, each returned to the user's own
      Chrome setting. On a live site, a second download from the same page now
      proceeds without a reload.

---

## Section 2: Cookie Settings and Session-Only Cookies

### Item 4: Session-only cookies

- [ ] **Test:** Open the extension popup. Toggle session-only cookies **on**. Navigate to `chrome://settings/content/cookies`. Examine the state. Toggle session-only cookies **off** in the popup.
- [ ] **Expected result:** When enabled, `chrome://settings/content/cookies` shows the session-only cookie state active under the "controlled by an extension" banner. When disabled, the extension's entry disappears entirely — the banner is gone and the user's own cookie setting is back in force. The extension does not write `allow` on the way out; Item 9b covers why that matters. Note: enabling this logs the user out of every website on browser restart — this is expected behavior and is why the setting defaults to off.

---

## Section 3: Global Privacy Control Signal

### Item 5: GPC signal detection

- [ ] **Test:** Enable the GPC toggle in the popup. Navigate to `https://global-privacy-control.glitch.me/`. The page displays whether the GPC signal is detected.
- [ ] **Expected result:** The page confirms the GPC signal is detected. Disable the toggle, reload the page, and confirm the signal is no longer detected.

---

## Section 4: Consent Management Platform (CMP) Enforcement — CORRECTNESS CRITICAL

These tests verify that the extension correctly dismisses consent banners and disables tracking categories on real-world websites using established consent platforms.

### Item 6: CMP banner dismissal and category settings

- [ ] **Test:** Visit the following websites with the extension enabled and cookie-banner toggle **on**. For each, observe whether the banner appears and, if the CMP exposes a preferences interface, whether tracking categories are off:
  - One site using **OneTrust** (e.g., example.com — verify via Cookiebot admin interface or inspect rules)
  - One site using **Cookiebot** (e.g., example.com)
  - One site using **Didomi** (e.g., example.com)
  - One site using **Usercentrics** (e.g., example.com)
  - One site using **Quantcast** (e.g., example.com)

- [ ] **Expected result:**
  - The banner is dismissed and does not reappear on page reload.
  - If the platform provides a preferences screen or settings interface, confirm that non-essential tracking categories are explicitly disabled (off).
  - Page layout is unaffected; no content is broken or misaligned.

### Item 6b: A CMP served from an iframe — the bbc.com/news case

The failure this catches: a CMP that renders its banner inside a cross-origin
iframe splits it across a frame boundary, and neither half looks like a banner
on its own. Nothing in the unit suite can time it, and the fixtures are a
snapshot of one site on one day.

- [ ] **Test:** With the cookie-banner toggle on, load `https://www.bbc.com/news`
      (Sourcepoint, frame served from `cdn.privacy-mgmt.com`) on a profile that
      has not accepted before. Watch for up to 15 seconds.
- [ ] **Expected result:** the "Terms of Use & Privacy" modal and its dimmed
      backdrop disappear, and the page underneath is clickable and scrolls. The
      extension hides the host page's `#sp_message_container_…` wrapper — check
      in DevTools that it carries `display: none`, and that nothing else on the
      page was hidden with it.
- [ ] **If the modal is still there after 15 s:** suspect the `QUIET_MS` gap
      rather than the frame-boundary fix. Sourcepoint reveals an
      already-inserted container by toggling an inline style, which the
      sweeper's observer does not watch, so it is only ever swept when some
      unrelated DOM change happens to schedule one. Confirm by reloading a few
      times and seeing whether it is intermittent, and record **how long after
      load** the overlay appears — that number is wanted and cannot be got
      anywhere but a real profile. A headless or preview browser suspends
      rendering in a backgrounded tab, which makes the overlay measure 0x0
      long after it is live. See the `QUIET_MS` entry in
      [KNOWN-ISSUES.md](KNOWN-ISSUES.md).
- [ ] **Test:** Repeat on one other iframe-hosted CMP whose origin is in
      `CMP_FRAME_HOSTS` (`src/content/cosmetic.js`) — OneTrust
      (`cdn.cookielaw.org`) or TrustArc (`consent.trustarc.com`).
- [ ] **Test (negative):** open a checkout that uses a Stripe-hosted iframe
      modal, or any site with a video lightbox served from a third party.
      **Expect:** untouched. The origin allowlist is the only thing standing
      between this pass and hiding those.

---

---

## Section 5: Newsletter Modal Dismissal — CORRECTNESS CRITICAL

### Item 7: Newsletter popup dismissal and page scroll

- [ ] **Test:** Visit five websites known for aggressive newsletter or signup prompts (e.g., news sites, e-commerce sites, blogs). Enable the newsletter-toggle in the popup. Observe whether popups are dismissed and the page is scrollable.
- [ ] **Expected result:**
  - Newsletter signup modals are dismissed without user interaction.
  - The page scrolls freely and the user can read content unobstructed.
  - The modal does not reappear on page reload (unless the site's own logic resets it).

---

## Section 6: Negative Pass — Do Not Dismiss Non-Consent Elements — CORRECTNESS CRITICAL

### Item 8: Login modals, cart drawers, and age gates remain untouched

- [ ] **Test:** On three different websites, trigger the following user-interface elements while the extension is enabled:
  - A login or authentication modal
  - A shopping-cart drawer or panel
  - An age-gate verification dialog

- [ ] **Expected result:**
  - **None of these modals are dismissed.** They remain open and functional. The user can interact with them normally (log in, add items, verify age).
  - The extension must not dismiss or hide login prompts, cart drawers, or age gates under any circumstances.

---

## Section 7: Pause and Resume Functionality

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
- [ ] **Test:** Pause a bare-IP dev server (`http://192.168.1.1/`, or whatever
      LAN address is to hand), then open the popup.
      **Expect:** no error line at the bottom of the popup, and no toggle row
      is flagged. `patternsFor` skips the `*.`-prefixed patterns for an
      address literal because Chrome rejects them; if the error line is back,
      that skip has regressed.
- [ ] **Test:** With that bare-IP site still paused, toggle any setting to
      force a rebuild of the dynamic rules, then check
      `chrome://extensions` → Errors, and confirm blocking still works on an
      ordinary site.
      **Expect:** no `updateDynamicRules` error. This is the one bare-IP path
      that is _not_ covered by the unit tests — `excludedRequestDomains` is
      only ever exercised against a stub, and Chrome fails that call
      atomically, which would freeze the previous dynamic rules in place.

### Item 9b: A toggle that is off leaves no extension-controlled setting

The failure this catches: writing a release value at `<all_urls>` when a
toggle is off puts the extension's preference _above_ the user's own, and for
cookies that value is `allow`. A default install would then force-allow
cookies browser-wide. Nothing but this check surfaces it.

- [ ] **Test:** On a **fresh profile**, load the unpacked extension and,
      without touching the popup, open `chrome://settings/content/cookies`.
      **Expect:** no "controlled by an extension" banner and no extension-set
      cookie state — `sessionOnlyCookies` is off by default, so the extension
      must have written nothing.
- [ ] **Test:** Turn a toggle on, confirm the extension banner appears on the
      matching `chrome://settings/content/...` page, then turn it off again.
      **Expect:** the banner disappears and the setting returns to whatever
      the user had chosen before, not to `ask` or `allow`.

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

### Item 11b: Resume button spacing — measure it, no test can

jsdom performs no layout, so the equal-spacing invariant on the Resume button
has no automated guard at all. Re-run this after **any** change to
`popup/popup.css`.

- [ ] **Test:** Open the popup on a paused site, inspect the Resume button in
      DevTools, and read its computed `margin-top` and `margin-bottom`.
      **Expect:** 12px and 12px (0.75rem at a 16px root). Both come from the
      single `margin-block` declaration on `#pause.primary`; if either reads
      differently, the base `#pause` rule has leaked into the paused layout.
- [ ] **Test:** While there, confirm by eye that the button sits as its own
      band — equal air above it to the banner and below it to the toggles.

---

## Section 8: Chrome Version and Enforcement Coverage

### Item 12: Chrome version and unenforced settings

- [ ] **Test:** Note your current Chrome version (`chrome://version/`).
- [ ] **Expected result:**
  - If Chrome is **141 or later**, all toggles (including sound) work in the browser settings.
  - If Chrome is **before 141**, open the popup and confirm that the sound toggle is labeled or marked as unenforced in the UI. The popup should surface this limitation clearly.

---

## Section 9: Google One Tap

### Item 13: One Tap after the FedCM migration — RESOLVED: NOT A NETWORK REQUEST

v1.1.2 narrowed the one-tap rule from the whole `accounts.google.com/gsi/`
path to the prompt iframe alone, to stop it breaking the ordinary "Sign in
with Google" button. One Tap then came back on fandom.com. The question was
whether the narrowing was wrong or the premise was.

The premise. `gsi/client` now raises the prompt through FedCM —
`navigator.credentials.get({identity: {providers: [...], mode: "passive"}})` —
and the card is drawn by the browser. The `gsi/iframe/select` sub_frame the
rule blocks is never requested, so the rule matches nothing. The old broad
rule had been suppressing One Tap by blocking `gsi/client` itself, which is
also what broke the button.

Verified against the built extension in a real Chromium, driven by Playwright,
on a page that calls `navigator.credentials.get` directly:

| Toggle | `mode: "passive"` (One Tap) | `mode: "active"` (button) | `{password: true}` |
| --- | --- | --- | --- |
| off (default) | reached the network, 16.5 s | reached the network, 12.5 s | untouched |
| on | refused in 0.2 ms | reached the network, 12.5 s | untouched |
| on, site paused | reached the network, 15.8 s | reached the network, 12.5 s | untouched |

The timings are the measurement, not a performance note: a call this extension
refuses returns in well under a millisecond without touching the network,
while a call it passes through spends seconds failing to reach Google from a
sandboxed runner. Nothing else distinguishes them — the guard deliberately
rejects with the same `NetworkError: Error retrieving a token.` that Chrome
itself returns.

Also confirmed in the same run:

- The guard is installed before the page's own first inline script, in all
  three configurations. This is why it is a manifest-declared `"world":
  "MAIN"` script and not the `gpc-inject.js` pattern, which lands tens of
  milliseconds late — fine for a property, useless for a method the page is
  about to call.
- With the toggle off, or the site paused, `navigator.credentials.get` is the
  native method again once the decision lands: the guard unwraps itself rather
  than sitting in the path of every credential request on the web.

- [ ] **Still to check by hand:** a real "Sign in with Google" button, clicked,
  on a site that uses one — with the toggle on. The automated pass proves
  active mode is forwarded to the browser, but not that a full sign-in
  completes.

---

## Summary

All items must be verified on a real Chrome profile with the extension loaded and active on real websites. Do not assume any behavior — test each item explicitly. If any item fails, record the failure as a bug report before considering this task complete. Items 6, 7, and 8 are correctness-critical: the extension must dismiss consent modals and newsletters while never dismissing authentication, commerce, or age-verification elements.
