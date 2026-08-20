# leave-me-alone

A Chrome extension that tells every website you visit to leave you alone — necessary cookies only, no notification prompts, no location requests, no newsletter popups. One panel of switches instead of preferences buried across a dozen menus.

Inspired by [a Bluesky post by Helen Barnard](https://bsky.app/profile/helenbarnard.bsky.social/post/3msv2feu6cc2i):

> But why can't I just have a google setting that just automatically tells every website I visit:
>
> - Only necessary cookies
> - Block notifications
> - I don't want to sign up to any newsletters
>
> Surely that should be possible.

## Status

**Complete, unverified on real websites.**

The code is complete and all 221 unit tests pass. The extension has not yet been tested in a real Chrome browser against live websites — this verification requires manual QA.

### To install and test:

```bash
npm install
npm run build
```

Then load the unpacked extension from `dist/` via `chrome://extensions` with Developer mode on.

### Manual QA:

See [docs/QA.md](docs/QA.md) for the checklist. This covers the `chrome.contentSettings` layer and real-world CMP behavior, which cannot be tested headlessly.

## Planned settings

**Primary:** cookie banners · notifications · location · newsletter popups

**More, on by default:** Global Privacy Control · popups & auto-downloads · camera & microphone

**More, off by default:** autoplay sound · hide chat bubbles · block Google one-tap · session-only cookies

Autoplay sound is off by default on purpose; see Item 3b in [docs/QA.md](docs/QA.md).

Known gaps and deferred findings are recorded in [docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md).

## Publishing

```bash
npm run package
```

builds `dist/` and writes the uploadable zip, manifest at its root.

Listing copy and the permission justifications live in
[docs/STORE-LISTING.md](docs/STORE-LISTING.md). `test/store-listing.test.js`
holds every field inside the store's character budget and fails if the manifest
gains a permission the listing does not justify. A rejection on either count
costs a review round trip measured in days.

Why the extension asks for `<all_urls>`, and why narrowing it would cost the
GPC signal while leaving the install prompt unchanged, is recorded in
[docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md).

## Privacy

The extension makes no network requests of its own and collects no data. Consent rules are bundled at build time rather than fetched at runtime.

## Credits

Cookie-banner rules are vendored from [Consent-O-Matic](https://github.com/cavi-au/Consent-O-Matic) (MIT), by the Center for Advanced Visualization and Interaction at Aarhus University.

## License

[MIT](LICENSE). The vendored Consent-O-Matic rules are MIT too — see [THIRD_PARTY.md](THIRD_PARTY.md).
