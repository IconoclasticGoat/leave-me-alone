// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createMatcher } from '../src/engine/matchers.js';

describe('createMatcher', () => {
  it('css matches when the selector hits', () => {
    document.body.innerHTML = `<div id="banner">hi</div>`;
    expect(createMatcher({ type: 'css', target: { selector: '#banner' } }).matches(document)).toBe(true);
  });

  it('css does not match when the selector misses', () => {
    document.body.innerHTML = ``;
    expect(createMatcher({ type: 'css', target: { selector: '#banner' } }).matches(document)).toBe(false);
  });

  it('checkbox reports the checked state', () => {
    document.body.innerHTML = `<input type="checkbox" id="c" checked>`;
    const m = createMatcher({ type: 'checkbox', target: { selector: '#c' } });
    expect(m.matches(document)).toBe(true);
    document.querySelector('#c').checked = false;
    expect(m.matches(document)).toBe(false);
  });

  it('onoff reads aria-checked for non-input toggles', () => {
    document.body.innerHTML = `<div id="t" role="switch" aria-checked="true"></div>`;
    const m = createMatcher({ type: 'onoff', target: { selector: '#t' } });
    expect(m.matches(document)).toBe(true);
  });

  it('unknown matcher types are false, never thrown', () => {
    expect(createMatcher({ type: 'nonsense' }).matches(document)).toBe(false);
  });
});
