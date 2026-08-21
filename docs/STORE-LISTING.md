# Chrome Web Store listing

Copy for the Web Store submission, kept in the repo so it is reviewed like
code and so a permission justification can be checked against the call it
actually defends. Every claim below is traceable to source; if a justification
and the code ever disagree, the code is right and this file is a bug.

Each field is fenced and preceded by a marker giving the store's field name and
its character budget. `test/store-listing.test.js` parses those markers and
fails if a field outgrows its budget. The store rejects on submit, which costs
a round trip.

Budgets marked *(self-imposed)* are our own cap, not Google's; the store's real
limit on justification fields is more generous, but a reviewer reads these, and
short ones read better.

---

## Product identity

<!-- field: name max: 75 -->
```
Leave Me Alone
```

<!-- field: short_description max: 132 -->
```
Necessary cookies only. No notification prompts, no location requests, no newsletter popups. On every site, automatically.
```

**Category:** Privacy & Security
**Language:** English

---

## Detailed description

<!-- field: detailed_description max: 16000 -->
```
Every website asks you the same questions. Accept cookies? Show notifications? Know your location? Join the newsletter? You answer them the same way every time, on every site, forever.

Leave Me Alone answers them for you: "Leave me alone."

Turn on the switches you want. From then on, every site you visit gets that answer before it asks, instead of asking you first.

WHAT IT DOES

On by default:
• Reject cookie banners: declines non-essential cookies on 200+ consent platforms, and hides the banner when it meets one it doesn't know
• Block notification prompts
• Block location requests
• Dismiss newsletter popups
• Send Global Privacy Control, the "do not sell my data" signal
• Block popups & automatic downloads
• Block camera & microphone prompts

Off by default, switch on if you want them:
• Mute all sites (silences them completely, not just autoplay)
• Hide chat bubbles
• Block Google one-tap sign-in
• Delete all cookies on quit

ONE SITE GIVING YOU TROUBLE?

Pause the extension on that site from the toolbar. Everything goes back to normal there and stays as you set it everywhere else. The toolbar icon tells you at a glance which mode you're in.

PRIVACY

This extension collects nothing, stores nothing about you, and makes no network requests of its own. Not analytics, not telemetry, not an "anonymous usage statistics" checkbox buried in the options.

Your switch settings are the only thing saved, and they are saved in your own Chrome profile.

The consent-platform rules are bundled inside the extension and updated only when the extension itself updates. Nothing is fetched at runtime. There is no server that could see where you browse, because there is no server.

HONEST ABOUT THE LIMITS

Cookie banners are an arms race. This handles the major consent platforms and falls back to hiding banners it doesn't recognise, but a site can always do something new. Blocking prompts is different. That runs through Chrome's own permission settings, so it is not a heuristic and does not miss.

OPEN SOURCE

MIT licensed. Read every line: https://github.com/IconoclasticGoat/leave-me-alone

Cookie-banner rules are from Consent-O-Matic (MIT), by the Center for Advanced Visualization and Interaction at Aarhus University.
```

---

## Privacy tab

### Single purpose

<!-- field: single_purpose max: 1000 (self-imposed) -->
```
Leave Me Alone applies one set of the user's privacy preferences automatically to every website they visit, so that they do not have to answer the same cookie, notification, location, and newsletter prompts on every site individually. Every feature serves that one purpose: each is a standing answer to a question sites would otherwise ask.
```

### Permission justifications

<!-- field: justification_storage max: 1000 (self-imposed) -->
```
Saves the user's switch settings and their list of paused sites, using chrome.storage.sync so that preferences persist between sessions and follow the user across their signed-in Chrome profiles.

This is the only thing the extension writes. It is read back only by the extension's own popup and background service worker to decide what to enforce. Nothing is transmitted anywhere. The extension makes no network requests at all.
```

<!-- field: justification_contentSettings max: 1000 (self-imposed) -->
```
This is the enforcement mechanism for six of the extension's switches. The extension calls chrome.contentSettings to set the browser's own defaults for notifications, location, camera, microphone, popups, automatic downloads, sound, and cookies.

Setting Chrome's default is the point: it means a site cannot prompt in the first place, rather than the extension racing to dismiss a prompt after it appears. There is no other API that can pre-answer a permission prompt.

Turning a switch off calls clear() for that type, handing it back to the user's own Chrome settings rather than leaving an extension-set value behind. Pausing a site writes a narrower per-domain exception so that site behaves exactly as it would without the extension installed.
```

<!-- field: justification_declarativeNetRequestWithHostAccess max: 1000 (self-imposed) -->
```
Three rules, all bundled in the package. No rules are fetched or updated at runtime.

1. Sets the "Sec-GPC: 1" request header when the user turns on Global Privacy Control. This is the header form of the opt-out signal recognised under CCPA/CPRA.
2. Blocks accounts.google.com/gsi/ when the user turns on "Block Google one-tap sign-in".
3. Blocks four known chat-widget script hosts when the user turns on "Hide chat bubbles".

Rules belonging to a switched-off setting are never registered, so a user who leaves rules 2 and 3 off has no blocking rules active at all. Paused domains are excluded from every rule.

The WithHostAccess form is used deliberately rather than plain declarativeNetRequest, to avoid adding a second, redundant install warning on top of the host permission already requested.
```

<!-- field: justification_host_permissions max: 1000 (self-imposed) -->
```
Two features require host access, and neither has a narrower form.

1. Global Privacy Control. Setting the Sec-GPC request header requires host access to the request URL. The signal is meaningless if scoped to a list of sites. Its entire purpose is to tell every site the user opts out, and a user cannot enumerate in advance the sites they have not visited yet.

2. The toolbar state. Reading tab.url tells the extension whether the current site is paused, which is what the icon and popup display. The "tabs" permission is the alternative and was rejected because its warning is broader than this one.

The content scripts likewise match all sites, because a cookie banner or newsletter popup can appear on any site and the user cannot list them ahead of time.

The extension makes no network requests of its own and sends no data anywhere. Host access is used to modify one outgoing header and to read the page the user is already looking at.
```

<!-- field: justification_remote_code max: 1000 (self-imposed) -->
```
No, this extension does not use remote code.

Every script is bundled in the package. The consent-platform rule database is inlined at build time and ships inside the extension; it is not fetched at runtime. There is no eval, no new Function, and no script loaded from any URL.
```

### Data usage

The extension collects **none** of the disclosable categories. Answer "no" to
all of: personally identifiable information, health information, financial and
payment information, authentication information, personal communications,
location, web history, user activity, website content.

Certify all three:

- Not being sold to third parties, outside of approved use cases
- Not being used or transferred for purposes unrelated to the item's single purpose
- Not being used or transferred to determine creditworthiness or for lending purposes

All three are true trivially: nothing is collected, so nothing can be sold,
repurposed, or used for lending decisions.

**Privacy policy URL:** not required while the data disclosures above are all
"no". Worth publishing a short one anyway, since the listing requests all-sites
access and a reviewer or a cautious user reaching for a policy and finding none
is a bad first impression.

---

## Before submitting

- ~~**Make the repository public**~~ — done.
  github.com/IconoclasticGoat/leave-me-alone is public, so the OPEN SOURCE
  paragraph's link resolves and the copy stands as written.
- ~~**Screenshots**~~ — done. Four 1280×800 shots and a 440×280 promo tile in
  `store/screenshots/`, regenerated by `npm run store-assets`. They are
  generated rather than hand-captured so they cannot drift from the product:
  the popup in every shot is the real `dist/popup`, and the "after" panes are
  produced by running the real `dist/content.js` against `demo/index.html`.
  Rebuild them after any change to the popup, the heuristics or the demo page.
- ~~**QA Item 3b**~~ — answered: full mute. The toggle is now "Mute all sites",
  still off by default. See Item 3b in [QA.md](QA.md).
- **Store icon**, 128×128. `icons/active-128.png` already qualifies.

---

## Dashboard fields that are not copy

These are decisions rather than text, so they are not fenced above, but they
are asked on submit and are easy to answer wrongly under time pressure.

**Publisher display name: `IconoclasticGoat`.** Chosen to match the GitHub
account the detailed description sends people to — on an extension requesting
access to every site, a byline that agrees with the source link is worth more
than a more formal-sounding one that doesn't. It is account-level and applies
to every extension ever published here, so future projects inherit it.

Treat it as permanent: Google documents where it appears but not whether it can
be changed, and there are developer reports of edits not propagating. Note it
is *not* the privacy lever — what determines whether personal contact details
go public is the trader declaration below, not this name.

**Trader / non-trader.** A mandatory EEA declaration under the Digital
Services Act, self-declared and the developer's responsibility to get right.
A **non-trader** is someone acting outside a trade, business or profession —
which is what a free, MIT-licensed extension with no payments is. Declaring
**trader** requires verification and publishes legal name, physical address,
email and phone number on the listing page. Do not declare trader to look more
official; it is a legal status, not a badge.

**Privacy policy URL.** Not required while every data disclosure is "no", but
published anyway at `docs/privacy.md` → the Pages site, because this listing
asks for access to every site.

**Category:** Privacy & Security. **Language:** English.

**Data usage.** Answer "no" to all nine disclosable categories, and certify all
three statements. All are true trivially: nothing is collected, so nothing can
be sold, repurposed, or used for lending decisions.
