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
});
