// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { TOGGLE_GROUPS, renderToggles } from '../popup/popup.js';

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
