// test/cosmetic.test.js
// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach } from 'vitest';
import { hideCookieBanners } from '../src/content/cosmetic.js';
import { restoreScroll } from '../src/content/scroll.js';

const mount = (html) => {
  document.body.innerHTML = html;
  for (const el of document.querySelectorAll('*')) {
    el.getBoundingClientRect = () => ({ width: 600, height: 90 });
  }
};

beforeEach(() => { document.body.innerHTML = ''; });

describe('hideCookieBanners', () => {
  it('hides a fixed banner mentioning cookies', () => {
    mount(`<div id="b" style="position:fixed;z-index:500">
      We use cookies to improve your experience. <button>Accept</button></div>`);
    expect(hideCookieBanners(document)).toBe(1);
    expect(document.querySelector('#b').style.display).toBe('none');
  });

  it('ignores cookie language that is not in a fixed or sticky element', () => {
    // Isolates the position guard: has cookie words AND an accept control.
    mount(`<div id="b"><p>We use cookies. Read our cookie policy.</p>
      <button>Accept</button></div>`);
    expect(hideCookieBanners(document)).toBe(0);
  });

  it('ignores a fixed bar with an accept-ish control but no cookie language', () => {
    // Isolates the cookie-language guard: fixed AND has a matching button.
    mount(`<nav id="b" style="position:fixed;z-index:500">
      <button>Accept</button> Home About Contact</nav>`);
    expect(hideCookieBanners(document)).toBe(0);
  });

  it('ignores an element too long to be a banner', () => {
    // Isolates the length cap — the guard that stops us blanking a page
    // whose whole wrapper happens to mention cookies.
    const filler = 'lorem ipsum dolor sit amet. '.repeat(80); // > 1200 chars
    mount(`<div id="b" style="position:fixed;z-index:500">
      <p>We use cookies. ${filler}</p><button>Accept</button></div>`);
    expect(hideCookieBanners(document)).toBe(0);
  });

  describe('reviewer-probed false positives', () => {
    it('leaves a fixed nav bar alone (cookie word and accept word both live only in <a> labels)', () => {
      // Isolates nothing in isolation — it is doubly guarded (prose-scoping
      // AND button-vs-anchor both independently zero it) which is exactly
      // the shape of the original bug report, so it's kept as a literal
      // regression fixture for that report rather than a single-condition
      // probe.
      mount(`<nav id="b" style="position:fixed;z-index:500">
        Home <a>Privacy preferences</a> <a>Bookings</a></nav>`);
      expect(hideCookieBanners(document)).toBe(0);
    });

    it('leaves a fixed "Order tracking" panel alone (no longer reads "tracking" as cookie language)', () => {
      // Matches the reviewer's literal probe. "tracking" is no longer a
      // COOKIE_WORD, so mentionsCookies is false here regardless of the
      // "Book a courier" button (which, incidentally, also no longer
      // fragment-matches "ok" post word-boundary fix — belt and braces).
      mount(`<div id="b" style="position:fixed;z-index:500">
        Order tracking. <button>Book a courier</button></div>`);
      expect(hideCookieBanners(document)).toBe(0);
    });

    it('leaves a sticky footer\'s "Cookie policy" link + <button>OK</button> alone', () => {
      // Isolates the prose-scoping fix: "Cookie policy" is a real cookie
      // word, and <button>OK</button> is a real whole-word accept control,
      // but the cookie word lives only inside a link label, not in the
      // element's own prose.
      mount(`<footer id="b" style="position:sticky;z-index:500">
        <a>Cookie policy</a> <button>OK</button></footer>`);
      expect(hideCookieBanners(document)).toBe(0);
    });
  });

  describe('single-condition guard isolation', () => {
    it('requires a whole-word accept match, not a substring ("Book" must not match "ok")', () => {
      // mentionsCookies is true via plain prose ("We use cookies."), so the
      // only thing that can produce 0 here is the word-boundary check on
      // the button text "Book a courier" (old code matched the "ok"
      // fragment inside "Book").
      mount(`<div id="b" style="position:fixed;z-index:500">
        We use cookies. <button>Book a courier</button></div>`);
      expect(hideCookieBanners(document)).toBe(0);
    });

    it('does not treat "tracking" as cookie language', () => {
      // hasButton is true ("Allow" is a real whole-word accept control), so
      // the only thing that can produce 0 here is COOKIE_WORDS no longer
      // containing "tracking".
      mount(`<div id="b" style="position:fixed;z-index:500">
        Order tracking status. <button>Allow</button></div>`);
      expect(hideCookieBanners(document)).toBe(0);
    });

    it('counts an href-less <a role="button"> as an accept control', () => {
      // The cookieconsent library's "Got it!" (neighborhoodscout.com,
      // captured 2026-09-06). mentionsCookies is true via plain prose, so
      // the only thing that can produce 1 here is isInPageControl accepting
      // an anchor with no href on the strength of role=button.
      mount(`<div id="b" style="position:fixed;z-index:500">
        We use cookies to improve your experience.
        <a role="button" tabindex="0" class="cc-btn cc-dismiss">Got it!</a></div>`);
      expect(hideCookieBanners(document)).toBe(1);
    });

    it('still ignores an <a role="button"> that navigates away', () => {
      // role=button only rescues an anchor that goes nowhere; one with an
      // off-page href is a styled link, and the navigation test still rules.
      mount(`<div id="b" style="position:fixed;z-index:500">
        We use cookies to improve your experience.
        <a role="button" href="https://example.com/privacy">OK</a></div>`);
      expect(hideCookieBanners(document)).toBe(0);
    });

    it('hides the captured cookieconsent banner when no rule runs', () => {
      // Defence in depth: the local rule normally claims this, but the
      // fallback must reach it on its own if the rule ever stops matching.
      mount(readFileSync('test/fixtures/cookieconsent-v3.html', 'utf8'));
      expect(hideCookieBanners(document)).toBe(1);
      expect(document.querySelector('.cc-window').style.display).toBe('none');
    });

    it('does not count an <a> as an accept control', () => {
      // mentionsCookies is true via plain prose ("We use cookies here."),
      // so the only thing that can produce 0 here is requiring the accept
      // control to be a real button/[role=button], not a bare <a> with
      // neither an href nor a role.
      mount(`<div id="b" style="position:fixed;z-index:500">
        We use cookies here. <a>Accept</a></div>`);
      expect(hideCookieBanners(document)).toBe(0);
    });

    it('does not count a cookie word that only appears inside a link/button label', () => {
      // hasButton is true (<button>OK</button> is a real whole-word accept
      // control), so the only thing that can produce 0 here is scoping the
      // cookie-word scan to the element's own prose, excluding link/button
      // labels ("Cookie policy" lives only inside the <a>).
      mount(`<footer id="b" style="position:sticky;z-index:500">
        <a>Cookie policy</a> <button>OK</button></footer>`);
      expect(hideCookieBanners(document)).toBe(0);
    });

    it('requires an accept control at all — cookie language alone is not enough (hasButton isolation)', () => {
      // mentionsCookies is true via plain prose and there is no button,
      // link, or [role=button] anywhere in the element. Only the
      // mentionsCookies && hasButton conjunction can produce 0 here.
      mount(`<div id="b" style="position:fixed;z-index:500">
        We use cookies on this site to improve your experience.</div>`);
      expect(hideCookieBanners(document)).toBe(0);
    });
  });
});

describe('hideCookieBanners on a CMP served from an iframe', () => {
  // The bbc.com/news shape, captured 2026-08-20. Sourcepoint splits the banner
  // across a frame boundary: the host page keeps a bare fixed <div> whose only
  // child is a cross-origin iframe, so it has no prose and no buttons for
  // looksLikeBanner to read; the prose and the button live in the frame's own
  // document, where the banner computes to `position: absolute` because the
  // host's wrapper owns the fixed placement. Neither side is a banner by
  // looksLikeBanner's reckoning, so an unhandled CMP survives both.
  const HOST = 'https://cdn.privacy-mgmt.com/us_pm/index.html?is_usnat_notice=true';

  it('hides the fixed wrapper around a CMP frame that carries no prose of its own', () => {
    mount(`<div id="b" style="position:fixed;inset:0;z-index:2147483647">
      <iframe id="f" src="${HOST}"></iframe></div>`);
    expect(hideCookieBanners(document)).toBe(1);
    expect(document.querySelector('#b').style.display).toBe('none');
  });

  it('hides the wrapper, not the frame — the overlay and the click blocker are the wrapper', () => {
    // Hiding only the iframe would leave a full-screen fixed div swallowing
    // every click on the page underneath.
    mount(`<div id="b" style="position:fixed;inset:0">
      <iframe id="f" src="${HOST}"></iframe></div>`);
    hideCookieBanners(document);
    expect(document.querySelector('#b').style.display).toBe('none');
    expect(document.querySelector('#f').style.display).toBe('');
  });

  it('counts one wrapper once even when it holds several CMP frames', () => {
    mount(`<div id="b" style="position:fixed;inset:0">
      <iframe src="${HOST}"></iframe><iframe src="${HOST}&second=1"></iframe></div>`);
    expect(hideCookieBanners(document)).toBe(1);
  });

  describe('single-condition guard isolation', () => {
    it('ignores a frame whose origin is not a known CMP host', () => {
      // Identical shape to the passing case — fixed wrapper, no prose, shown
      // frame — so only the origin allowlist can produce 0 here. This is the
      // guard that keeps a Stripe checkout or a video lightbox on the page.
      mount(`<div id="b" style="position:fixed;inset:0">
        <iframe id="f" src="https://checkout.stripe.com/pay/cs_test_123"></iframe></div>`);
      expect(hideCookieBanners(document)).toBe(0);
      expect(document.querySelector('#b').style.display).toBe('');
    });

    it('ignores a CMP frame with no fixed or sticky ancestor', () => {
      // The origin is allowlisted and the wrapper has no prose, so only the
      // fixed/sticky requirement can produce 0. An in-flow consent frame is
      // covering nothing and needs no rescuing.
      mount(`<div id="b"><iframe id="f" src="${HOST}"></iframe></div>`);
      expect(hideCookieBanners(document)).toBe(0);
    });

    it('leaves a fixed wrapper that carries prose of its own alone', () => {
      // Allowlisted origin, fixed wrapper — so only the empty-prose
      // requirement can produce 0. Prose means the host page owns real
      // content in this element, and hiding it would take that content too.
      mount(`<div id="b" style="position:fixed;inset:0">
        <p>Live coverage: markets open higher</p>
        <iframe id="f" src="${HOST}"></iframe></div>`);
      expect(hideCookieBanners(document)).toBe(0);
    });

    it('ignores a hidden CMP frame', () => {
      // Allowlisted origin, fixed wrapper, no prose — so only the isShown
      // check on the frame can produce 0. CMPs leave invisible utility
      // frames on the page long after the banner is gone.
      document.body.innerHTML = `<div id="b" style="position:fixed;inset:0">
        <iframe id="f" src="${HOST}" style="display:none"></iframe></div>`;
      for (const el of document.querySelectorAll('*')) {
        el.getBoundingClientRect = () => ({ width: 600, height: 400 });
      }
      expect(hideCookieBanners(document)).toBe(0);
    });
  });
});

describe('banners whose accept control is an anchor', () => {
  // drsquatch.com, captured 2026-08-21. No CMP vendor behind it, so the
  // cosmetic fallback is the only layer that can reach it — and its "OK" is an
  // <a href="/#privacy-acknowledged">, a same-document fragment that dismisses
  // the bar in place. Requiring a <button> missed it entirely.
  it('hides the captured drsquatch.com privacy bar', () => {
    mount(readFileSync('test/fixtures/drsquatch-privacy-bar.html', 'utf8'));
    expect(hideCookieBanners(document)).toBe(1);
    expect(document.querySelector('[data-privacy-banner]').style.display).toBe('none');
  });

  it('counts an anchor that only sets a fragment as an accept control', () => {
    mount(`<div id="b" style="position:fixed">We use cookies.
      <a href="#accepted">OK</a></div>`);
    expect(hideCookieBanners(document)).toBe(1);
  });

  it('counts an anchor with a javascript: href', () => {
    mount(`<div id="b" style="position:fixed">We use cookies.
      <a href="javascript:void(0)">Accept</a></div>`);
    expect(hideCookieBanners(document)).toBe(1);
  });

  describe('single-condition guard isolation', () => {
    it('does not count an anchor that navigates somewhere else', () => {
      // Isolates the same-document test. Identical shape to the passing case
      // — fixed, cookie prose, accept word — so only the href can produce 0.
      // This is what keeps a footer's policy links from reading as consent.
      mount(`<div id="b" style="position:fixed">We use cookies.
        <a href="https://example.com/policy">Accept</a></div>`);
      expect(hideCookieBanners(document)).toBe(0);
    });

    it('does not count an anchor to the same path on a different origin', () => {
      // Isolates the origin test specifically. jsdom serves these at
      // http://localhost:3000/, so this href matches on pathname and search
      // and differs only in origin — nothing else here can produce 0.
      mount(`<div id="b" style="position:fixed">We use cookies.
        <a href="https://consent-partner.example/">OK</a></div>`);
      expect(hideCookieBanners(document)).toBe(0);
    });

    it('does not count an anchor pointing at another path on the same site', () => {
      mount(`<div id="b" style="position:fixed">We use cookies.
        <a href="/legal/cookies">OK</a></div>`);
      expect(hideCookieBanners(document)).toBe(0);
    });
  });
});

describe('the captured bbc.com/news banner', () => {
  // Both halves of one real Sourcepoint US notice, captured 2026-08-20. The
  // pair is the regression: the fix has to work on the host side, because
  // there is nothing to be done from inside the frame.
  it('hides the host page\'s overlay', () => {
    mount(readFileSync('test/fixtures/sourcepoint-host-frame.html', 'utf8'));
    expect(hideCookieBanners(document)).toBe(1);
    expect(document.querySelector('#sp_message_container_1504881').style.display).toBe('none');
    expect(document.querySelector('main').style.display).toBe('');
  });

  it('does nothing from inside the frame, where the banner is not fixed', () => {
    // The same content script runs in the frame (all_frames: true) and sees
    // the prose and the button — but the banner there computes to
    // `position: absolute`, verified against the live page, because the
    // host's wrapper owns the fixed placement. Hiding it there would leave
    // the wrapper swallowing clicks anyway.
    mount(readFileSync('test/fixtures/sourcepoint-usnat-frame.html', 'utf8'));
    expect(hideCookieBanners(document)).toBe(0);
  });
});

describe('a banner rendered inside a shadow root', () => {
  // commure.com, captured 2026-08-31. An Osano "consent opt-in" widget renders
  // its whole banner — prose and buttons — inside an OPEN shadow root on a bare
  // host <div> (display: contents). querySelectorAll stops at the shadow
  // boundary, so neither the rule engine nor the light-DOM cosmetic pass can
  // see it. The banner itself passes every looksLikeBanner check; it was only
  // ever unreachable.
  const stub = (el) => { el.getBoundingClientRect = () => ({ width: 600, height: 90 }); };

  it('hides a fixed cookie banner living in an open shadow root', () => {
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.querySelector('#host');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<div id="b" style="position:fixed;z-index:500">
      By clicking Accept you agree to the storing of cookies.
      <button>Accept</button></div>`;
    stub(host);
    for (const el of shadow.querySelectorAll('*')) stub(el);

    expect(hideCookieBanners(document)).toBe(1);
    expect(shadow.querySelector('#b').style.display).toBe('none');
  });

  it('does not throw on a closed shadow root it cannot enter', () => {
    // A closed root exposes no shadowRoot to script, so it is unreachable by
    // design — the sweep must skip it cleanly rather than choke on it.
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.querySelector('#host');
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `<div id="b" style="position:fixed;z-index:500">
      We use cookies. <button>Accept</button></div>`;
    stub(host);
    for (const el of shadow.querySelectorAll('*')) stub(el);

    expect(hideCookieBanners(document)).toBe(0);
  });
});

describe('a CMP rendered inside a same-origin iframe', () => {
  // rula.com, captured 2026-09-10. BigID renders its banner into a same-origin
  // iframe (id="bigidcmp-banner-widget", empty src, position: fixed): the prose
  // and the Reject/Accept buttons live in the FRAME's own document, which the
  // light-DOM pass never queries into, while the frame's src is the page's own
  // origin so the cross-origin allowlist (isCmpFrame) never matches it either.
  // The frame is readable because it is same-origin, so the fix reads inside to
  // confirm the banner and hides the frame element, which is the fixed bar.
  const bannerHtml = `<div class="wrap">
    <p>We use cookies to improve and personalize our site, support marketing,
    and analyze usage. By selecting "Reject," you opt out of targeted
    advertising.</p>
    <a href="https://www.rula.com/privacy-policy/">Privacy policy</a>
    <button>Reject</button><button>Accept all</button></div>`;

  // Build a same-origin iframe and write the banner into its own document, then
  // stub the geometry both documents' isShown() reads.
  const mountFrame = (style, inner) => {
    document.body.innerHTML = `<iframe id="f" style="${style}"></iframe>`;
    const f = document.querySelector('#f');
    f.getBoundingClientRect = () => ({ width: 1265, height: 147 });
    f.contentDocument.body.innerHTML = inner;
    for (const el of f.contentDocument.querySelectorAll('*')) {
      el.getBoundingClientRect = () => ({ width: 600, height: 90 });
    }
    return f;
  };

  it('hides a fixed same-origin iframe whose document is a cookie banner', () => {
    const f = mountFrame('position:fixed;z-index:2147483647', bannerHtml);
    expect(hideCookieBanners(document)).toBe(1);
    expect(f.style.display).toBe('none');
  });

  describe('single-condition guard isolation', () => {
    it('ignores a fixed same-origin iframe whose document has no cookie language', () => {
      // Same shape — shown, fixed, has an accept control — so only the
      // cookie-language requirement can produce 0. Keeps an ordinary fixed
      // widget iframe (a support chat, say) on the page.
      const f = mountFrame('position:fixed',
        '<p>Chat with our team! <button>Accept the invite</button></p>');
      expect(hideCookieBanners(document)).toBe(0);
      expect(f.style.display).toBe('');
    });

    it('ignores a same-origin cookie iframe that is not fixed or sticky', () => {
      // Cookie prose and a Reject button inside, but the frame is in-flow, so
      // only the fixed/sticky requirement can produce 0. An in-flow frame is
      // covering nothing and needs no rescuing.
      const f = mountFrame('', bannerHtml);
      expect(hideCookieBanners(document)).toBe(0);
      expect(f.style.display).toBe('');
    });

    it('ignores a fixed same-origin cookie iframe with no accept/reject control', () => {
      // Shown, fixed, cookie prose — so only the accept-control requirement can
      // produce 0. The lone link navigates away, which acceptControls filters
      // out exactly as it does in the light DOM.
      const f = mountFrame('position:fixed',
        `<p>We use cookies to personalize our site.</p>
         <a href="https://www.rula.com/privacy-policy/">Privacy policy</a>`);
      expect(hideCookieBanners(document)).toBe(0);
      expect(f.style.display).toBe('');
    });
  });
});

describe('restoreScroll', () => {
  it('clears overflow hidden on body and html', () => {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    restoreScroll(document);
    expect(document.body.style.overflow).toBe('');
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('clears a fixed body position', () => {
    document.body.style.position = 'fixed';
    restoreScroll(document);
    expect(document.body.style.position).toBe('');
  });

  it('removes scroll-lock classes', () => {
    document.body.className = 'modal-open some-app-class no-scroll';
    restoreScroll(document);
    expect(document.body.classList.contains('modal-open')).toBe(false);
    expect(document.body.classList.contains('no-scroll')).toBe(false);
    // Unrelated classes must survive — we restore scrolling, not restyle.
    expect(document.body.classList.contains('some-app-class')).toBe(true);
  });

  it('never adds a restriction to an unlocked page', () => {
    document.body.style.overflow = 'auto';
    restoreScroll(document);
    expect(document.body.style.overflow).toBe('auto');
  });
});
