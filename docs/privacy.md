---
title: Privacy policy
---

# Privacy policy — Leave Me Alone

**Last updated: 21 August 2026**

Leave Me Alone collects no personal data, sends no data anywhere, and makes no
network requests of its own.

There is no server. There is no analytics, no telemetry, no crash reporting,
no "anonymous usage statistics" setting. Nothing about your browsing is
recorded, transmitted, or shared, because nothing in the extension is capable
of doing so.

## What the extension stores

Two things, both inside your own browser:

1. **Your switch settings** — which of the eleven toggles are on or off.
2. **Your paused sites** — the list of domains where you have chosen to turn
   the extension off.

Both are written with [`chrome.storage.sync`][sync], the browser's own
preference storage. That means they are saved in your Chrome profile and, if
you are signed in to Chrome with sync enabled, are synced across your own
devices by Google as part of ordinary Chrome sync. We do not operate that
sync, receive anything from it, or have any way to read it. It is Chrome
storing your preferences the same way it stores your bookmarks. If you are not
signed in, the settings never leave the machine.

The extension also writes one item to local, non-synced storage: a record of
any content setting your Chrome version could not apply, so the popup can tell
you a switch is not being enforced. It contains setting names and error text,
never anything about the pages you visit.

Uninstalling the extension removes all of it.

## What the extension does not store

The extension never records the pages you visit, your browsing history, the
contents of any page, form data, credentials, or anything you type. It builds
no profile of you. The only site names it holds are ones you explicitly typed
into the pause list by pressing Pause on that site.

## Permissions, and why each exists

- **Host access to all sites** (`<all_urls>`) — two features need it. Global
  Privacy Control sets the `Sec-GPC` request header, which requires access to
  the request being sent, and the signal is meaningless if limited to a list
  of sites. Reading the current tab's address tells the toolbar icon whether
  this site is paused. Nothing is transmitted as a result of this access.
- **Content settings** — the extension sets Chrome's own defaults for
  notifications, location, camera, microphone, sound and cookies. This is what
  makes a site unable to prompt you in the first place. Turning a switch off
  hands the setting back to your own Chrome settings.
- **Storage** — the two items described above.
- **Declarative net request (with host access)** — three bundled rules: the
  `Sec-GPC` header, and two optional blocks (Google one-tap sign-in, chat
  widget scripts) that are only registered when you turn those switches on.

## Remote code and updates

No remote code is executed and none can be. Every script ships inside the
extension package. The consent-platform rule database is compiled into the
extension at build time and is not fetched at runtime; it changes only when
you receive an extension update through the Chrome Web Store.

## Changes to this policy

Any change will be published on this page with a new date. Because the
extension collects nothing, a change here would mean the extension itself had
changed — and the source is public, so you can check.

## Source and contact

The complete source is at
[github.com/IconoclasticGoat/leave-me-alone](https://github.com/IconoclasticGoat/leave-me-alone),
MIT licensed. Questions and reports:
[open an issue](https://github.com/IconoclasticGoat/leave-me-alone/issues).

[sync]: https://developer.chrome.com/docs/extensions/reference/api/storage#property-sync
