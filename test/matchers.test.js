// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createMatcher, matchesAll } from '../src/engine/matchers.js';

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
    expect(createMatcher(null).matches(document)).toBe(false);
    expect(createMatcher({ type: 'css' }).matches(document)).toBe(false); // no target
  });

  it('reads on/off from a data-checked attribute', () => {
    document.body.innerHTML = `<div id="t" data-checked="true"></div>`;
    expect(createMatcher({ type: 'onoff', target: { selector: '#t' } })
      .matches(document)).toBe(true);
    document.querySelector('#t').setAttribute('data-checked', 'false');
    expect(createMatcher({ type: 'onoff', target: { selector: '#t' } })
      .matches(document)).toBe(false);
  });

  it('reads on/off from a class name when nothing else is present', () => {
    document.body.innerHTML = `<div id="on" class="checked"></div><div id="off"></div>`;
    const m = (sel) => createMatcher({ type: 'checkbox', target: { selector: sel } })
      .matches(document);
    expect(m('#on')).toBe(true);
    expect(m('#off')).toBe(false);
  });
});

describe('url matcher', () => {
  it('matches the current href', () => {
    // vitest's jsdom default location is http://localhost:3000/
    expect(createMatcher({ type: 'url', target: { regex: 'localhost' } })
      .matches(document)).toBe(true);
    expect(createMatcher({ type: 'url', target: { regex: 'example\\.com' } })
      .matches(document)).toBe(false);
  });

  it('returns false rather than throwing on a malformed pattern', () => {
    const m = createMatcher({ type: 'url', target: { regex: '[' } });
    expect(() => m.matches(document)).not.toThrow();
    expect(m.matches(document)).toBe(false);
  });

  it('one malformed pattern does not void a valid sibling', () => {
    const m = createMatcher({ type: 'url', target: { urlFilter: ['[', 'localhost'] } });
    expect(m.matches(document)).toBe(true);
  });
});

describe('matchesAll', () => {
  it('is false for an empty list — a detector with no matchers matches nothing', () => {
    expect(matchesAll([], document)).toBe(false);
  });

  it('accepts a single config that is not wrapped in an array', () => {
    document.body.innerHTML = `<div id="b"></div>`;
    expect(matchesAll({ type: 'css', target: { selector: '#b' } }, document)).toBe(true);
  });

  it('requires every config to match', () => {
    document.body.innerHTML = `<div id="a"></div>`;
    const present = { type: 'css', target: { selector: '#a' } };
    const absent = { type: 'css', target: { selector: '#nope' } };
    expect(matchesAll([present, present], document)).toBe(true);
    expect(matchesAll([present, absent], document)).toBe(false);
  });

  it('survives a matcher that throws', () => {
    document.body.innerHTML = `<div id="a"></div>`;
    expect(matchesAll([{ type: 'url', target: { regex: '(' } }], document)).toBe(false);
  });
});
