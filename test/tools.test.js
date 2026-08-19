// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { isShown, matchesText, queryAll, waitFor } from '../src/engine/tools.js';

describe('isShown', () => {
  it('is false for display:none', () => {
    document.body.innerHTML = `<div id="a" style="display:none">x</div>`;
    expect(isShown(document.querySelector('#a'))).toBe(false);
  });
  it('is true for a laid-out element', () => {
    document.body.innerHTML = `<div id="a">x</div>`;
    const el = document.querySelector('#a');
    el.getBoundingClientRect = () => ({ width: 100, height: 20 });
    expect(isShown(el)).toBe(true);
  });
});

describe('matchesText', () => {
  it('matches case-insensitively on trimmed text', () => {
    document.body.innerHTML = `<button>  Manage Cookies </button>`;
    expect(matchesText(document.querySelector('button'), ['manage cookies'])).toBe(true);
  });
  it('returns true when no filter is given', () => {
    document.body.innerHTML = `<button>x</button>`;
    expect(matchesText(document.querySelector('button'), undefined)).toBe(true);
  });
});

describe('queryAll', () => {
  it('applies selector and textFilter together', () => {
    document.body.innerHTML = `<a class="b">Accept</a><a class="b">Reject</a>`;
    const r = queryAll(document, { selector: '.b', textFilter: ['reject'] });
    expect(r).toHaveLength(1);
    expect(r[0].textContent).toBe('Reject');
  });
  it('returns [] for a selector that matches nothing', () => {
    document.body.innerHTML = ``;
    expect(queryAll(document, { selector: '.nope' })).toEqual([]);
  });
});

describe('waitFor', () => {
  it('resolves null on timeout rather than throwing', async () => {
    expect(await waitFor(() => null, 30)).toBe(null);
  });
  it('resolves with the value once available', async () => {
    let v = null;
    setTimeout(() => { v = 'ready'; }, 10);
    expect(await waitFor(() => v, 500)).toBe('ready');
  });
  it('treats a throwing predicate as not-ready, never rejecting', async () => {
    expect(await waitFor(() => { throw new Error('boom'); }, 30)).toBe(null);
  });
});

// These are the page-safety guarantees. They are the reason this layer
// exists in the shape it does, so they get explicit tests.
describe('queryAll never throws into the page', () => {
  it('returns [] for a malformed selector', () => {
    document.body.innerHTML = `<div>x</div>`;
    expect(queryAll(document, { selector: '[unclosed' })).toEqual([]);
    expect(queryAll(document, { selector: ':::bad' })).toEqual([]);
  });

  it('returns [] when an element throws during filtering', () => {
    document.body.innerHTML = `<div id="a">x</div>`;
    const el = document.querySelector('#a');
    // Simulates a node whose document lost its browsing context.
    Object.defineProperty(el, 'ownerDocument', {
      get() { throw new Error('detached'); },
    });
    expect(queryAll(document, { selector: '#a', displayFilter: true })).toEqual([]);
  });

  it('applies displayFilter, excluding hidden elements', () => {
    document.body.innerHTML =
      `<div class="c" id="v">shown</div><div class="c" style="display:none">hidden</div>`;
    document.querySelector('#v').getBoundingClientRect = () => ({ width: 10, height: 10 });
    const r = queryAll(document, { selector: '.c', displayFilter: true });
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('v');
  });

  const ROWS =
    `<div class="row" id="has"><input type="checkbox"></div>` +
    `<div class="row" id="lacks"><span>no input</span></div>`;

  // Every childFilter in the bundle wraps its selector in `target`; the bare
  // shape is accepted as well, so both are pinned here.
  it.each([
    ['wrapped in target', { target: { selector: 'input' } }],
    ['bare', { selector: 'input' }],
  ])('applies childFilter (%s), requiring a descendant match', (_label, childFilter) => {
    document.body.innerHTML = ROWS;
    const r = queryAll(document, { selector: '.row', childFilter });
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('has');
  });

  it('inverts childFilter when childFilterNegate is set', () => {
    document.body.innerHTML = ROWS;
    const r = queryAll(document, {
      selector: '.row',
      childFilter: { target: { selector: 'input' } },
      childFilterNegate: true,
    });
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('lacks');
  });
});

describe('isShown on a detached document', () => {
  it('is false rather than throwing when defaultView is null', () => {
    document.body.innerHTML = `<div id="a">x</div>`;
    const el = document.querySelector('#a');
    Object.defineProperty(el, 'ownerDocument', { get: () => ({ defaultView: null }) });
    expect(() => isShown(el)).not.toThrow();
    expect(isShown(el)).toBe(false);
  });
});

describe('matchesText with malformed rule data', () => {
  it('accepts a bare string where an array was expected', () => {
    document.body.innerHTML = `<button>Reject all</button>`;
    expect(matchesText(document.querySelector('button'), 'reject')).toBe(true);
  });
});
