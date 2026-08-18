// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { TOGGLE_GROUPS, renderToggles, markUnenforced, applyPausedState } from '../popup/popup.js';

describe('popup', () => {
  it('puts exactly the four complaint toggles in the primary group', () => {
    expect(TOGGLE_GROUPS.primary.map((t) => t.key))
      .toEqual(['cookieBanners', 'notifications', 'location', 'newsletters']);
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
