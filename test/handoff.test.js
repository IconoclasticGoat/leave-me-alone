// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runEngine } from '../src/engine/index.js';
import { createSweeper } from '../src/content/index.js';

const BUNDLE = JSON.parse(readFileSync('src/rules/bundle.json', 'utf8'));
const BANNER = readFileSync('test/fixtures/onetrust-investing.html', 'utf8');

// Measured on uk.investing.com: the preference centre takes ~222ms to render
// after OPEN_OPTIONS clicks "Show Purposes".
const PANEL_RENDER_MS = 222;

// Mirrors the live .ot-cat-item markup, including the nesting — the switch is
// NOT a direct child of .ot-cat-item, it sits under .ot-acc-hdr > .ot-tgl.
// Category names must be the real ones: the rule keys its per-category
// branches off .ot-cat-header text.
const CATEGORIES = [
  { id: 'C0002', name: 'Performance Cookies' },
  { id: 'C0003', name: 'Functional Cookies' },
  { id: 'C0004', name: 'Targeting Cookies' },
];

function catItem({ id, name }, on) {
  return `<div class="ot-accordion-layout ot-cat-item ot-vs-config" data-optanongroupid="${id}">
    <div class="ot-acc-hdr">
      <h4 class="ot-cat-header" id="ot-header-id-${id}">${name}</h4>
      <div class="ot-tgl">
        <input type="checkbox" name="ot-group-id-${id}" id="ot-group-id-${id}" role="switch"
               class="category-switch-handler" data-optanongroupid="${id}" ${on ? 'checked' : ''}>
        <label class="ot-switch" for="ot-group-id-${id}"><span class="ot-switch-nob"></span>
          <span class="ot-label-txt">${name}</span></label>
      </div>
    </div>
  </div>`;
}

function panelHtml(on) {
  return `<div id="onetrust-pc-sdk" class="otPcCenter">
    ${CATEGORIES.map((c, i) => catItem(c, on[i])).join('')}
    <div class="ot-accordion-layout ot-cat-item" data-optanongroupid="C0001">
      <div class="ot-acc-hdr"><h4 class="ot-cat-header">Strictly Necessary Cookies</h4></div>
    </div>
    <button class="save-preference-btn-handler">Confirm My Choices</button>
  </div>`;
}

function mountBanner({ on = [false, false, false] } = {}) {
  document.body.innerHTML = BANNER;
  const sdk = document.querySelector('#onetrust-consent-sdk');
  document.querySelector('#onetrust-pc-btn-handler').addEventListener('click', () => {
    setTimeout(() => sdk.insertAdjacentHTML('beforeend', panelHtml(on)), PANEL_RENDER_MS);
  });
  return sdk;
}

const switches = () => [...document.querySelectorAll('input.category-switch-handler')];
const visible = (sel) => {
  const el = document.querySelector(sel);
  return !!el && el.style.display !== 'none';
};
const onSaveClick = () => {
  const fn = vi.fn();
  document.querySelector('.save-preference-btn-handler').addEventListener('click', fn);
  return fn;
};

async function stage1ThenPanel(opts) {
  mountBanner(opts);
  const staged = await runEngine(BUNDLE, document);
  await new Promise((r) => setTimeout(r, PANEL_RENDER_MS + 60));
  return staged;
}

beforeEach(() => {
  Element.prototype.getBoundingClientRect = () => ({ width: 200, height: 50 });
  document.body.innerHTML = '';
});

describe('stage 1 -> stage 2 handoff', () => {
  it('stage 1 opens the panel, claims nothing, and hides nothing', async () => {
    mountBanner();
    const r = await runEngine(BUNDLE, document);
    expect(r).toMatchObject({ handled: null, reason: 'staged', cmp: 'onetrust' });
    // Hiding here would bury the panel stage 2 detects.
    expect(visible('#onetrust-consent-sdk')).toBe(true);
  });

  it('stage 2 switches every category off and saves', async () => {
    const staged = await stage1ThenPanel({ on: [true, true, false] });
    const saved = onSaveClick();

    const r = await runEngine(BUNDLE, document, { skip: new Set([staged.cmp]) });

    expect(r.handled).toBe('onetrust_pcpanel');
    expect(switches()).toHaveLength(3);
    expect(switches().every((b) => !b.checked)).toBe(true);
    expect(saved).toHaveBeenCalled();
    expect(visible('#onetrust-pc-sdk')).toBe(false);
  });

  it('refuses to save while a category it cannot switch off is still on', async () => {
    const staged = await stage1ThenPanel({ on: [true, false, false] });
    // A switch that will not move: the CMP swallows the click.
    const stuck = switches()[0];
    Object.defineProperty(stuck, 'checked', { get: () => true, set: () => {} });

    const saved = onSaveClick();
    const r = await runEngine(BUNDLE, document, { skip: new Set([staged.cmp]) });

    // Saving here would confirm the site's defaults rather than our rejection.
    expect(saved).not.toHaveBeenCalled();
    expect(r.handled).toBe(null);
    expect(visible('#onetrust-pc-sdk')).toBe(true);
  });
});

describe('the sweeper across both stages', () => {
  const start = () => {
    const s = createSweeper({
      settings: { cookieBanners: true, newsletters: false }, bundle: BUNDLE,
    });
    s.start();
    return s;
  };

  it('does not hide the CMP while the handoff is still in flight', async () => {
    mountBanner();
    const s = start();
    await new Promise((r) => setTimeout(r, 80));   // before the panel renders
    s.stop();
    expect(visible('#onetrust-consent-sdk')).toBe(true);
  });

  it('carries the handoff through to a saved rejection on its own', async () => {
    mountBanner({ on: [true, true, true] });
    const s = start();
    for (let i = 0; i < 200 && visible('#onetrust-pc-sdk') !== false; i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
    s.stop();
    expect(switches().every((b) => !b.checked)).toBe(true);
    expect(visible('#onetrust-pc-sdk')).toBe(false);
  }, 20000);
});
