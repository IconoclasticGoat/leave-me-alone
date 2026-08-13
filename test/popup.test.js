// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { TOGGLE_GROUPS, renderToggles, markUnenforced } from '../popup/popup.js';

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
