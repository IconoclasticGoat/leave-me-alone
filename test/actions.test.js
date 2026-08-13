// test/actions.test.js
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createAction, UnsupportedAction } from '../src/engine/actions.js';

const ctx = { shouldAllow: () => false, runMethod: vi.fn() };
const run = (config, root = document) => createAction(config, ctx).execute(root);

describe('click', () => {
  it('clicks the first match only', async () => {
    document.body.innerHTML = `<button class="b">a</button><button class="b">b</button>`;
    const spies = [...document.querySelectorAll('.b')].map((el) => vi.spyOn(el, 'click'));
    await run({ type: 'click', target: { selector: '.b' } });
    expect(spies[0]).toHaveBeenCalled();
    expect(spies[1]).not.toHaveBeenCalled();
  });

  it('is a no-op when nothing matches', async () => {
    document.body.innerHTML = ``;
    await expect(run({ type: 'click', target: { selector: '.gone' } })).resolves.toBeUndefined();
  });
});

describe('multiclick', () => {
  it('clicks every match', async () => {
    document.body.innerHTML = `<button class="b">a</button><button class="b">b</button>`;
    const spies = [...document.querySelectorAll('.b')].map((el) => vi.spyOn(el, 'click'));
    await run({ type: 'multiclick', target: { selector: '.b' } });
    expect(spies.every((s) => s.mock.calls.length === 1)).toBe(true);
  });
});

describe('list', () => {
  it('runs child actions in order', async () => {
    document.body.innerHTML = `<button id="one">1</button><button id="two">2</button>`;
    const order = [];
    for (const id of ['one', 'two']) {
      document.querySelector(`#${id}`).addEventListener('click', () => order.push(id));
    }
    await run({ type: 'list', actions: [
      { type: 'click', target: { selector: '#one' } },
      { type: 'click', target: { selector: '#two' } },
    ]});
    expect(order).toEqual(['one', 'two']);
  });
});

describe('consent', () => {
  it('unticks an enabled category', async () => {
    document.body.innerHTML = `<input type="checkbox" id="marketing" checked>`;
    await run({ type: 'consent', consents: [{
      type: 'E',
      matcher: { type: 'checkbox', target: { selector: '#marketing' } },
      toggleAction: { type: 'click', target: { selector: '#marketing' } },
    }]});
    expect(document.querySelector('#marketing').checked).toBe(false);
  });

  it('leaves an already-off category alone', async () => {
    document.body.innerHTML = `<input type="checkbox" id="marketing">`;
    const spy = vi.spyOn(document.querySelector('#marketing'), 'click');
    await run({ type: 'consent', consents: [{
      type: 'E',
      matcher: { type: 'checkbox', target: { selector: '#marketing' } },
      toggleAction: { type: 'click', target: { selector: '#marketing' } },
    }]});
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses to toggle when the rule gives no matcher', async () => {
    document.body.innerHTML = `<input type="checkbox" id="m" checked>`;
    const spy = vi.spyOn(document.querySelector('#m'), 'click');
    await run({ type: 'consent', consents: [{
      type: 'E', toggleAction: { type: 'click', target: { selector: '#m' } },
    }]});
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('ifcss', () => {
  it('runs trueAction when present', async () => {
    document.body.innerHTML = `<div id="x"></div><button id="t">t</button>`;
    const spy = vi.spyOn(document.querySelector('#t'), 'click');
    await run({ type: 'ifcss', target: { selector: '#x' },
      trueAction: { type: 'click', target: { selector: '#t' } } });
    expect(spy).toHaveBeenCalled();
  });

  it('runs falseAction when absent', async () => {
    document.body.innerHTML = `<button id="f">f</button>`;
    const spy = vi.spyOn(document.querySelector('#f'), 'click');
    await run({ type: 'ifcss', target: { selector: '#nope' },
      falseAction: { type: 'click', target: { selector: '#f' } } });
    expect(spy).toHaveBeenCalled();
  });
});

describe('foreach', () => {
  it('scopes the child action to each match', async () => {
    document.body.innerHTML =
      `<div class="row"><input type="checkbox" checked></div>` +
      `<div class="row"><input type="checkbox" checked></div>`;
    await run({ type: 'foreach', target: { selector: '.row' },
      action: { type: 'click', target: { selector: 'input' } } });
    expect([...document.querySelectorAll('input')].every((i) => !i.checked)).toBe(true);
  });
});

describe('hide', () => {
  it('sets display none', async () => {
    document.body.innerHTML = `<div id="b">banner</div>`;
    await run({ type: 'hide', target: { selector: '#b' } });
    expect(document.querySelector('#b').style.display).toBe('none');
  });
});

describe('ifallownone', () => {
  it('takes the true branch because we reject everything', async () => {
    document.body.innerHTML = `<button id="t">t</button>`;
    const spy = vi.spyOn(document.querySelector('#t'), 'click');
    await run({ type: 'ifallownone', trueAction: { type: 'click', target: { selector: '#t' } } });
    expect(spy).toHaveBeenCalled();
  });
});

describe('unsupported', () => {
  it('throws UnsupportedAction for slide', async () => {
    await expect(run({ type: 'slide' })).rejects.toBeInstanceOf(UnsupportedAction);
  });
});
