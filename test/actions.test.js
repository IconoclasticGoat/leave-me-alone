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

  it('prefers falseAction over toggling when both are given', async () => {
    // The highest-risk ordering in the engine: if toggling won instead,
    // an already-on category could be double-handled and left enabled.
    document.body.innerHTML =
      `<input type="checkbox" id="m" checked><button id="reject">Reject</button>`;
    const toggle = vi.spyOn(document.querySelector('#m'), 'click');
    const direct = vi.spyOn(document.querySelector('#reject'), 'click');
    await run({ type: 'consent', consents: [{
      type: 'E',
      falseAction: { type: 'click', target: { selector: '#reject' } },
      matcher: { type: 'checkbox', target: { selector: '#m' } },
      toggleAction: { type: 'click', target: { selector: '#m' } },
    }]});
    expect(direct).toHaveBeenCalled();
    expect(toggle).not.toHaveBeenCalled();
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

describe('wait and close', () => {
  it('wait resolves after its configured delay', async () => {
    const t0 = Date.now();
    await run({ type: 'wait', waitTime: 30 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(25);
  });

  it('close calls the global close', async () => {
    const spy = vi.fn();
    const original = globalThis.close;
    globalThis.close = spy;
    await run({ type: 'close' });
    globalThis.close = original;
    expect(spy).toHaveBeenCalled();
  });
});

describe('waitcss', () => {
  it('resolves once the selector appears', async () => {
    document.body.innerHTML = ``;
    setTimeout(() => { document.body.innerHTML = `<div id="late">here</div>`; }, 20);
    await run({ type: 'waitcss', target: { selector: '#late' }, timeout: 500 });
    expect(document.querySelector('#late')).not.toBe(null);
  });

  it('gives up at the timeout instead of hanging', async () => {
    document.body.innerHTML = ``;
    const t0 = Date.now();
    await run({ type: 'waitcss', target: { selector: '#never' }, timeout: 60 });
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('waits for absence when negated', async () => {
    document.body.innerHTML = `<div id="going">x</div>`;
    setTimeout(() => { document.querySelector('#going').remove(); }, 20);
    await run({ type: 'waitcss', target: { selector: '#going' }, negated: true, timeout: 500 });
    expect(document.querySelector('#going')).toBe(null);
  });
});

describe('ifallowall', () => {
  it('takes the false branch, because nothing is ever allowed', async () => {
    document.body.innerHTML = `<button id="t">t</button><button id="f">f</button>`;
    const t = vi.spyOn(document.querySelector('#t'), 'click');
    const f = vi.spyOn(document.querySelector('#f'), 'click');
    await run({ type: 'ifallowall',
      trueAction: { type: 'click', target: { selector: '#t' } },
      falseAction: { type: 'click', target: { selector: '#f' } } });
    expect(f).toHaveBeenCalled();
    expect(t).not.toHaveBeenCalled();
  });
});
