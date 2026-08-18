# Manual QA Checklist

**Status: NEVER RUN**

This checklist has not been executed. No results below should be interpreted as verified.

---

## Why manual testing?

The `chrome.contentSettings` layer — which enforces the actual browser-level privacy settings (notifications, location, camera, microphone, popups, downloads, sound, cookies) — cannot be tested headlessly or in unit tests. Additionally, real-world consent-management platform (CMP) behavior is vendor-specific and evolves frequently. This checklist documents the verification that must occur in a real Chrome profile against live websites. Unit tests cover the rule engine, heuristics, and decision logic; this checklist covers whether those decisions actually work in the browser.

---

## Setup

Before running any item below:
- Build the extension: `npm install && npm run build`
- Load unpacked from `dist/` via `chrome://extensions` with Developer mode on
- Ensure all toggles in the popup are visible and functional
- Open the popup when a test requires toggling

---

## Section 1: Chrome Content Settings (Notifications, Location, Camera, Microphone, Popups, Downloads, Sound)

These tests verify that toggling the extension's controls correctly updates the browser's underlying `chrome.contentSettings` API, and that those settings persist across browser restarts.

### Item 1: Notifications setting

- [ ] **Test:** Load unpacked from `dist/`. Navigate to `chrome://settings/content/notifications`. Before opening the popup, confirm the setting shows "Don't allow sites to send notifications."
- [ ] **Expected result:** The setting is already restricted because the extension sets it on load with the default toggle state.

### Item 2: Notifications toggle

- [ ] **Test:** Open the extension popup. Toggle notifications **off** (disable the toggle). Reload `chrome://settings/content/notifications`. Toggle notifications **on** (enable the toggle) in the popup. Reload the settings page again.
- [ ] **Expected result:** When the toggle is off, the setting reads "Don't allow sites to send notifications." When the toggle is on, the setting reads "Allow sites to send notifications."

### Item 3: Other content settings (Location, Camera, Microphone, Popups, Automatic Downloads, Sound)

- [ ] **Test:** Repeat the pattern from Item 2 for each setting:
  - Location: `chrome://settings/content/location`
  - Camera: `chrome://settings/content/camera`
  - Microphone: `chrome://settings/content/microphone`
  - Popups: `chrome://settings/content/popups`
  - Automatic downloads: `chrome://settings/content/automaticDownloads`
  - Sound: `chrome://settings/content/sound` (Chrome 141+ only; on older versions, the popup should surface this as unenforced)

- [ ] **Expected result:** Each toggle correctly flips the corresponding setting. The browser UI reflects every change immediately or on reload.

---

## Section 2: Cookie Settings and Session-Only Cookies

### Item 4: Session-only cookies

- [ ] **Test:** Open the extension popup. Toggle session-only cookies **on**. Navigate to `chrome://settings/content/cookies`. Examine the state. Toggle session-only cookies **off** in the popup.
- [ ] **Expected result:** When enabled, `chrome://settings/content/cookies` shows the session-only cookie state active. When disabled, the setting reverts. Note: enabling this logs the user out of every website on browser restart — this is expected behavior and is why the setting defaults to off.

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

### Item 9b: A toggle that is off leaves no extension-controlled setting

The failure this catches: writing a release value at `<all_urls>` when a
toggle is off puts the extension's preference *above* the user's own, and for
cookies and popups that value is `allow`. A default install would then
force-allow cookies browser-wide. Nothing but this check surfaces it.

- [ ] **Test:** On a **fresh profile**, load the unpacked extension and,
      without touching the popup, open `chrome://settings/content/cookies`.
      **Expect:** no "controlled by an extension" banner and no extension-set
      cookie state — `sessionOnlyCookies` is off by default, so the extension
      must have written nothing.
- [ ] **Test:** Same profile, open `chrome://settings/content/popups`.
      Then turn "Block popups & automatic downloads" **off** in the popup and
      reload the settings page. **Expect:** Chrome's own default (block) is
      still in force and no extension banner appears. The extension must never
      make popups *more* permitted than Chrome's default.
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

## Summary

All items must be verified on a real Chrome profile with the extension loaded and active on real websites. Do not assume any behavior — test each item explicitly. If any item fails, record the failure as a bug report before considering this task complete. Items 6, 7, and 8 are correctness-critical: the extension must dismiss consent modals and newsletters while never dismissing authentication, commerce, or age-verification elements.
