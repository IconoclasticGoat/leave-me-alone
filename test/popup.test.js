// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { TOGGLE_GROUPS, renderToggles, markUnenforced, applyPausedState, applyCamAllowState, init } from '../popup/popup.js';
import { DEFAULTS } from '../src/settings.js';

describe('popup', () => {
  it('lists the more group with every default-on toggle before every default-off one', () => {
    // The grouping is the whole point of the section: someone opening "more"
    // reads down a list that starts with what is already working and ends
    // with what they can opt into. Flipping a default without moving the row
    // interleaves the two halves and quietly destroys that reading order,
    // and nothing else in the suite would notice.
    const defaults = TOGGLE_GROUPS.more.map((t) => DEFAULTS[t.key]);
    const firstOff = defaults.indexOf(false);
    expect(firstOff).toBeGreaterThan(0);
    expect(defaults.slice(firstOff)).not.toContain(true);
  });

  it('leaves autoplay sound off by default', () => {
    // Deliberate, and load-bearing for the store listing, which advertises it
    // under "off by default". QA Item 3b established that Chrome's `sound`
    // block is a full mute, not autoplay suppression, so on-by-default would
    // ship a silent YouTube. See the note in src/settings.js.
    expect(DEFAULTS.autoplaySound).toBe(false);
  });

  it('puts exactly the four complaint toggles in the primary group', () => {
    expect(TOGGLE_GROUPS.primary.map((t) => t.key))
      .toEqual(['cookieBanners', 'notifications', 'location', 'newsletters']);
  });

  // The label alone still undersells a full mute: "Mute all sites" reads as
  // "sites don't make noise at me", not "play does nothing". QA Item 3b.
  it('warns that the mute toggle survives pressing play', () => {
    const t = TOGGLE_GROUPS.more.find((t) => t.key === 'autoplaySound');
    expect(t.label).toBe('Mute all sites');
    expect(t.warning).toMatch(/press play/i);
  });

  it('warns on the session-cookie toggle', () => {
    const t = TOGGLE_GROUPS.more.find((t) => t.key === 'sessionOnlyCookies');
    expect(t.warning).toMatch(/log(ged)? out/i);
  });

  it('renders a checkbox per toggle reflecting current state', () => {
    const el = document.createElement('div');
    renderToggles(el, { cookieBanners: true, notifications: false });
    expect(el.querySelector('#toggle-cookieBanners').checked).toBe(true);
    expect(el.querySelector('#toggle-notifications').checked).toBe(false);
  });
});

describe('markUnenforced', () => {
  const mount = () => {
    document.body.innerHTML = '<div id="toggles"></div><p id="errors"></p>';
    renderToggles(document.querySelector('#toggles'), {});
    return document;
  };

  it('collapses two failures from one toggle into a single label', () => {
    const doc = mount();
    // cameraMic drives both camera and microphone; the user has one switch.
    markUnenforced(doc, [
      { type: 'camera', settingKey: 'cameraMic', error: 'x' },
      { type: 'microphone', settingKey: 'cameraMic', error: 'x' },
    ]);
    const text = doc.querySelector('#errors').textContent;
    expect(text).toContain('Block camera & microphone prompts');
    expect(text.match(/camera/gi)).toHaveLength(1);
  });

  it('marks the row of the toggle that failed', () => {
    const doc = mount();
    markUnenforced(doc, [{ type: 'sound', settingKey: 'autoplaySound', error: 'x' }]);
    const row = doc.querySelector('#toggle-autoplaySound').closest('.row');
    expect(row.classList.contains('unenforced')).toBe(true);
    expect(doc.querySelector('#toggle-notifications').closest('.row')
      .classList.contains('unenforced')).toBe(false);
  });

  it('says nothing when everything applied', () => {
    const doc = mount();
    markUnenforced(doc, []);
    expect(doc.querySelector('#errors').textContent).toBe('');
    expect(doc.querySelectorAll('.unenforced')).toHaveLength(0);
  });

  // applyContentSettings reports two unrelated kinds of failure through the
  // same list. A whole-type failure really is the Chrome version (sound
  // needs 141+). A per-domain failure is a match pattern Chrome refused for
  // one paused site — the version is irrelevant, the toggle is working, and
  // it is the *pause* that did not take. Same wording for both told the
  // user the wrong thing about half of them.
  const patternFailure = (type, settingKey, pattern) =>
    ({ type, settingKey, error: `Invalid value for pattern (pattern ${pattern})` });

  it('blames the paused domain, not the Chrome version, for a rejected pattern', () => {
    const doc = mount();
    markUnenforced(doc, [patternFailure('location', 'location', 'http://*.192.168.1.1/*')]);
    const text = doc.querySelector('#errors').textContent;
    expect(text).toContain('192.168.1.1');
    expect(text).not.toContain('Chrome version');
  });

  it('names the toggle a failed pause left in force on that domain', () => {
    const doc = mount();
    markUnenforced(doc, [patternFailure('location', 'location', 'https://*.dev.local/*')]);
    expect(doc.querySelector('#errors').textContent).toContain('Block location requests');
  });

  it('reports a version failure and a pattern failure as separate statements', () => {
    const doc = mount();
    markUnenforced(doc, [
      { type: 'sound', settingKey: 'autoplaySound', error: 'unsupported' },
      patternFailure('location', 'location', 'http://*.192.168.1.1/*'),
    ]);
    const lines = [...doc.querySelectorAll('#errors > *')].map((el) => el.textContent);
    expect(lines).toHaveLength(2);

    const version = lines.find((l) => l.includes('Chrome version'));
    const pattern = lines.find((l) => l.includes('192.168.1.1'));
    expect(version).toContain('Mute all sites');
    // The version sentence must not absorb the pattern failure's toggle —
    // that is the exact lie this whole split exists to stop telling.
    expect(version).not.toContain('Block location requests');
    expect(pattern).toContain('Block location requests');
  });

  it('does not dim a row whose toggle is enforced, only over-enforced', () => {
    // '.unenforced' dims the row to mean "this switch is doing nothing".
    // For a pattern failure the switch is doing exactly what it says — it is
    // the paused exception that is missing — so dimming it would be a second
    // lie on top of the copy.
    const doc = mount();
    markUnenforced(doc, [patternFailure('location', 'location', 'http://*.192.168.1.1/*')]);
    const row = doc.querySelector('#toggle-location').closest('.row');
    expect(row.classList.contains('unenforced')).toBe(false);
    expect(row.classList.contains('pause-unapplied')).toBe(true);
  });

  it('names a domain once when several types failed on it', () => {
    const doc = mount();
    markUnenforced(doc, [
      patternFailure('location', 'location', 'http://*.192.168.1.1/*'),
      patternFailure('notifications', 'notifications', 'https://*.192.168.1.1/*'),
    ]);
    const text = doc.querySelector('#errors').textContent;
    expect(text.match(/192\.168\.1\.1/g)).toHaveLength(1);
    expect(text).toContain('Block location requests');
    expect(text).toContain('Block notification prompts');
  });

  it('replaces a previous report instead of appending to it', () => {
    const doc = mount();
    markUnenforced(doc, [patternFailure('location', 'location', 'http://*.192.168.1.1/*')]);
    markUnenforced(doc, [{ type: 'sound', settingKey: 'autoplaySound', error: 'unsupported' }]);
    const text = doc.querySelector('#errors').textContent;
    expect(text).not.toContain('192.168.1.1');
    expect(text).toContain('Mute all sites');
  });
});

describe('renderToggles disabled flag', () => {
  it('leaves toggles interactive by default', () => {
    const el = document.createElement('div');
    renderToggles(el, { cookieBanners: true });
    expect(el.querySelector('#toggle-cookieBanners').disabled).toBe(false);
  });

  it('disables every toggle when asked', () => {
    // Dimming alone tells a sighted user; the disabled attribute is what
    // tells assistive technology the same thing.
    const el = document.createElement('div');
    renderToggles(el, { cookieBanners: true }, { disabled: true });
    for (const input of el.querySelectorAll('input')) {
      expect(input.disabled).toBe(true);
    }
  });
});

describe('applyPausedState', () => {
  const mount = () => {
    document.body.innerHTML =
      '<h1></h1><div id="status"></div><div id="toggles"></div>' +
      '<p id="errors"></p><button id="pause"></button>';
    return document;
  };

  it('labels the button to pause when the site is running', () => {
    const doc = mount();
    applyPausedState(doc, 'example.com', false);
    expect(doc.querySelector('#pause').textContent).toBe('Pause on example.com');
    expect(doc.querySelector('#status').textContent).toBe('');
  });

  it('labels the button to resume and promotes it when paused', () => {
    const doc = mount();
    applyPausedState(doc, 'example.com', true);
    const btn = doc.querySelector('#pause');
    expect(btn.textContent).toBe('Resume on example.com');
    expect(btn.classList.contains('primary')).toBe(true);
  });

  it('moves the button into the banner so it sits above the toggles', () => {
    const doc = mount();
    applyPausedState(doc, 'example.com', true);
    expect(doc.querySelector('#status').contains(doc.querySelector('#pause'))).toBe(true);
  });

  it('names the host and explains what pause covers', () => {
    const doc = mount();
    applyPausedState(doc, 'example.com', true);
    const text = doc.querySelector('#status').textContent;
    expect(text).toContain('Paused on example.com');
    expect(text).toContain(
      'Nothing is being blocked here. Cookie banners, prompts, and trackers all behave as the site intends.'
    );
  });

  it('shows the paused icon in the banner', () => {
    const doc = mount();
    applyPausedState(doc, 'example.com', true);
    expect(doc.querySelector('#status img').getAttribute('src')).toBe('../icons/paused-48.png');
  });

  it('clears a previous banner when called again for a running site', () => {
    const doc = mount();
    applyPausedState(doc, 'example.com', true);
    applyPausedState(doc, 'example.com', false);
    expect(doc.querySelector('#status').textContent).toBe('');
    expect(doc.querySelector('#status').querySelector('#pause')).toBe(null);
  });
});

describe('applyCamAllowState', () => {
  const mount = () => {
    document.body.innerHTML = '<button id="allow-cam"></button>';
    return document;
  };

  it('labels the action to take, not the current state', () => {
    const doc = mount();
    applyCamAllowState(doc, 'meet.google.com', false);
    const btn = doc.querySelector('#allow-cam');
    expect(btn.textContent).toBe('Allow camera & mic on meet.google.com');
    expect(btn.classList.contains('primary')).toBe(false);
  });

  it('marks an allowed site primary and offers to stop allowing', () => {
    const doc = mount();
    applyCamAllowState(doc, 'meet.google.com', true);
    const btn = doc.querySelector('#allow-cam');
    expect(btn.textContent).toBe('Stop allowing camera & mic on meet.google.com');
    expect(btn.classList.contains('primary')).toBe(true);
  });
});

describe('init', () => {
  beforeEach(() => {
    // init()'s click handler closes the popup. jsdom's real window.close()
    // tears down the document, taking every test after it with it.
    vi.spyOn(window, 'close').mockImplementation(() => {});
  });

  const mount = () => {
    document.body.innerHTML =
      '<h1></h1><div id="status"></div><div id="toggles"></div>' +
      '<p id="errors" class="errors"></p><button id="pause"></button>' +
      '<button id="allow-cam" hidden></button>';
    return document;
  };

  // Only the pieces init() actually touches. sync holds settings, the paused
  // list, and the camera/mic allowlist; local holds the last apply's failures.
  const stubChrome = ({ url, pausedSites = [], cameraMic = false, cameraMicAllowlist = [], lastApplyErrors = [] }) => {
    const sync = { pausedSites, cameraMic, cameraMicAllowlist };
    globalThis.chrome = {
      tabs: { query: async () => (url === null ? [] : [{ url }]) },
      storage: {
        sync: {
          get: async (defaults) => ({ ...defaults, ...sync }),
          set: async (obj) => { Object.assign(sync, obj); },
        },
        local: { get: async (defaults) => ({ ...defaults, lastApplyErrors }) },
      },
    };
    return sync;
  };

  // A bracketed IPv6 literal is the reachable version of this: HOSTNAME_RE
  // rejects it, so today's pauseSite would refuse to store it — but a value
  // stored by an older build is already synced into chrome.storage.sync, and
  // isPaused matches it exactly. The user is on http://[::1]:3000/ with the
  // extension paused and no way to say so.
  const LEGACY = '[::1]';

  it('offers Resume for a paused host that can no longer be stored', async () => {
    const doc = mount();
    stubChrome({ url: `http://${LEGACY}:3000/app`, pausedSites: [LEGACY] });

    await init();

    const btn = doc.querySelector('#pause');
    expect(btn.hidden).toBe(false);
    expect(btn.textContent).toBe(`Resume on ${LEGACY}`);
    expect(doc.querySelector('#status').textContent).toContain(`Paused on ${LEGACY}`);
  });

  it('actually resumes that host when the button is clicked', async () => {
    // The button existing is worth nothing if unpauseSite cannot remove the
    // very value that stranded the user.
    const doc = mount();
    const sync = stubChrome({ url: `http://${LEGACY}:3000/app`, pausedSites: [LEGACY] });

    await init();
    doc.querySelector('#pause').click();
    // The handler awaits a storage read and a write; drain both.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sync.pausedSites).toEqual([]);
  });

  it('still hides the button for an unstorable host that is not paused', async () => {
    // Nothing to resume, and pauseSite would refuse to store it: a button
    // here would silently do nothing.
    const doc = mount();
    stubChrome({ url: 'http://*.com/' });

    await init();

    expect(doc.querySelector('#pause').hidden).toBe(true);
  });

  it('surfaces apply errors even when the pause button is hidden', async () => {
    // The early return skipped markUnenforced entirely, so a user on a host
    // with no pause button also lost the only report of what failed.
    const doc = mount();
    stubChrome({
      url: 'http://*.com/',
      lastApplyErrors: [{ type: 'sound', settingKey: 'autoplaySound', error: 'unsupported' }],
    });

    await init();

    expect(doc.querySelector('#errors').textContent).toContain('Mute all sites');
  });

  it('offers Pause on an ordinary host', async () => {
    const doc = mount();
    stubChrome({ url: 'https://www.example.com/article' });

    await init();

    const btn = doc.querySelector('#pause');
    expect(btn.hidden).toBe(false);
    expect(btn.textContent).toBe('Pause on www.example.com');
    expect(doc.querySelector('#toggle-notifications').disabled).toBe(false);
  });

  it('hides the button and disables nothing on a tab with no url', async () => {
    const doc = mount();
    stubChrome({ url: null });

    await init();

    expect(doc.querySelector('#pause').hidden).toBe(true);
    expect(doc.querySelector('#toggle-notifications').disabled).toBe(false);
  });

  // The per-site camera/mic allow control.

  it('hides the allow-camera button when the cameraMic block is off', async () => {
    // With the block off, camera/mic already work everywhere; the button
    // would offer to grant something that is not being denied.
    const doc = mount();
    stubChrome({ url: 'https://meet.google.com/abc', cameraMic: false });

    await init();

    expect(doc.querySelector('#allow-cam').hidden).toBe(true);
  });

  it('offers to allow camera & mic on a storable host while the block is on', async () => {
    const doc = mount();
    stubChrome({ url: 'https://meet.google.com/abc', cameraMic: true });

    await init();

    const btn = doc.querySelector('#allow-cam');
    expect(btn.hidden).toBe(false);
    expect(btn.textContent).toBe('Allow camera & mic on meet.google.com');
  });

  it('adds the host to the allowlist when clicked', async () => {
    const doc = mount();
    const sync = stubChrome({ url: 'https://meet.google.com/abc', cameraMic: true });

    await init();
    doc.querySelector('#allow-cam').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sync.cameraMicAllowlist).toEqual(['meet.google.com']);
  });

  it('offers to stop allowing, and removes the host, when already allowed', async () => {
    const doc = mount();
    const sync = stubChrome({
      url: 'https://meet.google.com/abc',
      cameraMic: true,
      cameraMicAllowlist: ['meet.google.com'],
    });

    await init();
    const btn = doc.querySelector('#allow-cam');
    expect(btn.textContent).toBe('Stop allowing camera & mic on meet.google.com');

    btn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sync.cameraMicAllowlist).toEqual([]);
  });

  it('hides the allow-camera button on a paused site, which already releases camera/mic', async () => {
    const doc = mount();
    stubChrome({
      url: 'https://meet.google.com/abc',
      cameraMic: true,
      pausedSites: ['meet.google.com'],
    });

    await init();

    expect(doc.querySelector('#allow-cam').hidden).toBe(true);
  });
});
