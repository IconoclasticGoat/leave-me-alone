# Plan: SMS signups + the missing-vocabulary gap

Two changes to [../../../src/content/newsletter.js](../../../src/content/newsletter.js),
both driven by what live sites actually do. The supporting evidence — the live
DOM dumps and the sites they came from — lives in the untracked manual-QA notes
(`docs/manual-testing/test-sites.md`), deliberately kept out of the repo.

Do these as two separate commits. Change 1 is small and low-risk; change 2 loosens
a hard refusal and needs the more careful test pass.

---

## Change 1 — widen `SUBSCRIBE_WORDS` (small, high value)

**Why.** Three live ConvertKit/Kit popups (natashaskitchen.com,
spendwithpennies.com, wellplated.com) clear every gate and fail only the
vocabulary check. Today's word list assumes popups say "newsletter" or
"subscribe"; recipe blogs say "Send me the recipes" and "Download now".

**Do.** Add to `SUBSCRIBE_WORDS`:

```js
'like to receive',   // ConvertKit/Kit default consent line — matched all 3 live popups
'free ebook', 'free guide', 'free printable',  // the recipe-blog lead magnet
```

Two phrases from the first draft of this plan were dropped during
implementation: `send me the` collides with passwordless auth ("send me the
login link"), which would break a login — there is now a regression test
pinning that; and `get the recipes` is over-fit to one site, already covered by
`like to receive`.

`like to receive` is the load-bearing one; the rest are cheap breadth. Match the
substring without the leading `I'd` — the sites disagree on straight vs curly
apostrophe, and dropping it avoids normalizing.

**Risk.** Low. These phrases don't appear in auth or commerce copy, and every
existing refusal still runs first.

**Tests.** Add the ConvertKit shape (text-typed `name="email_address"`, a name
field, curly apostrophe, `.formkit-close`) as a positive in
`test/newsletter.test.js`.

---

## Change 2 — accept phone-only signup overlays

**Why.** huckberry.com's full-screen "Signup for texts and Get 10% Off Today" is
the same dark pattern with a phone field instead of an email field — same
interruption, same intent. Same modal on desktop and mobile emulation.

**The danger.** `hasEmail` is currently doing real safety work. Phone fields also
appear in checkout, delivery address forms, and 2FA/OTP flows — all things that
must never be dismissed. So do **not** simply relax the gate to
`hasEmail || hasPhone`.

**Do.** Require a positive SMS-marketing signal for the phone-only branch. US SMS
marketing consent copy is legally boilerplate, which makes it a high-precision
marker. All of these appear verbatim in Huckberry's modal:

```js
const SMS_MARKERS = [
  'msg & data rates', 'msg frequency', 'message frequency',
  'reply stop', 'reply help', 'text stop',
  'recurring automated', 'marketing text messages',
];

const hasPhone = Boolean(el.querySelector(
  'input[type=tel], input[name*="phone" i], input[placeholder*="phone" i]'
));
```

Then the final decision becomes:

- `hasEmail && SUBSCRIBE_WORDS.some(...)` — unchanged
- `hasPhone && SMS_MARKERS.some(...)` — new branch

An SMS marker alone is not enough without the phone field, and a phone field
alone is never enough.

**Also add these to `AUTH_MARKERS`**, since the phone branch newly exposes us to
OTP and checkout overlays:

```js
'security code', 'confirm your number', 'verify your number',
'shipping', 'billing', 'delivery address', 'card number', 'checkout',
```

**What already protects us, and should be kept:**

- The `isOverlay` gate. Huckberry's *inline footer* signup carries identical SMS
  consent copy but is `position: relative` with no z-index, so it is excluded.
  Verified on the live page — this is why the phone branch is safe to add.
- The `inputs.length > 2` limit, which rules out checkout and address forms.

**Tests.**

- Positive: Huckberry-shaped modal — phone field, `msg & data rates`, no email.
- Negative: OTP overlay ("Enter the security code we sent to •••1234") with a
  phone/code field.
- Negative: checkout overlay with phone + shipping fields (also caught by the
  input-count limit — assert both, so the test still means something if one
  guard is later relaxed).
- Negative: the inline `position: relative` footer signup with the same SMS copy.
- Regression: the existing exclusivity tests must still pass untouched.

---

## Out of scope, but note it

The `QUIET_MS` observer window (10 s, already in
[../../KNOWN-ISSUES.md](../../KNOWN-ISSUES.md)) limits both changes. natashaskitchen's
popup fires early enough to be caught; spendwithpennies and wellplated needed a
scroll to ~2000 px, which in a real session can easily land after the window has
closed. Fixing detection without fixing the window will still look like a miss on
scroll-triggered popups — worth sequencing that change alongside these.
