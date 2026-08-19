// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach } from 'vitest';
import { runEngine } from '../src/engine/index.js';
import { queryAll } from '../src/engine/tools.js';

const BUNDLE = JSON.parse(readFileSync('src/rules/bundle.json', 'utf8'));

beforeEach(() => {
  document.body.innerHTML = readFileSync('test/fixtures/onetrust-investing.html', 'utf8');
  // jsdom gives every element a zero rect; make the banner "visible".
  for (const el of document.querySelectorAll('*')) {
    el.getBoundingClientRect = () => ({ width: 200, height: 50 });
  }
});

describe('queryAll childFilterNegate', () => {
  it('keeps elements that do NOT contain the filtered child', () => {
    const hits = queryAll(document, {
      selector: '#onetrust-banner-sdk',
      childFilter: { target: { selector: '.otPcCenter' } },
      childFilterNegate: true,
    });
    expect(hits).toHaveLength(1);
  });

  it('drops elements that DO contain the filtered child', () => {
    const hits = queryAll(document, {
      selector: '#onetrust-consent-sdk',
      childFilter: { target: { selector: '#onetrust-banner-sdk' } },
      childFilterNegate: true,
    });
    expect(hits).toHaveLength(0);
  });

  it('is unchanged when childFilterNegate is absent', () => {
    expect(queryAll(document, {
      selector: '#onetrust-consent-sdk',
      childFilter: { target: { selector: '#onetrust-banner-sdk' } },
    })).toHaveLength(1);
  });
});

describe('runEngine on the real investing.com OneTrust banner', () => {
  it('reaches the full `onetrust` rule, not the UTILITY-only `onetrust_banner`', async () => {
    const r = await runEngine(BUNDLE, document);
    expect(r.cmp).toBe('onetrust');
  });

  it('hands off rather than claiming a banner it has not resolved', async () => {
    // This fixture is the banner alone. Opening its options is all stage 1
    // can do; the consent work belongs to onetrust_pcpanel once the panel
    // renders, which test/handoff.test.js drives end to end.
    const r = await runEngine(BUNDLE, document);
    expect(r).toMatchObject({ handled: null, reason: 'staged' });
  });

  it('leaves the CMP visible for the panel stage to find', async () => {
    await runEngine(BUNDLE, document);
    const sdk = document.querySelector('#onetrust-consent-sdk');
    // Hiding here would bury the panel onetrust_pcpanel detects.
    expect(sdk.style.display).toBe('');
  });
});

describe('a rule whose ordered methods carry no action', () => {
  const utilityOnly = {
    rules: {
      utilityOnly: {
        detectors: [{
          presentMatcher: [{ type: 'css', target: { selector: '#onetrust-banner-sdk' } }],
          showingMatcher: [{ type: 'css', target: { selector: '#onetrust-banner-sdk' } }],
        }],
        // Exactly the shape of the vendored `onetrust_banner`: the real work
        // lives in UTILITY, which is not part of the automatic run order.
        methods: [
          { name: 'HIDE_CMP' }, { name: 'OPEN_OPTIONS' },
          { name: 'DO_CONSENT' }, { name: 'SAVE_CONSENT' },
          { name: 'UTILITY', action: { type: 'hide', target: { selector: '#onetrust-banner-sdk' } } },
        ],
      },
    },
  };

  it('is not reported as handled', async () => {
    const r = await runEngine(utilityOnly, document);
    expect(r.handled).toBe(null);
  });

  it('does not stop a later rule that can actually act', async () => {
    const bundle = {
      rules: {
        ...utilityOnly.rules,
        realRule: {
          detectors: [{
            presentMatcher: [{ type: 'css', target: { selector: '#onetrust-banner-sdk' } }],
            showingMatcher: [{ type: 'css', target: { selector: '#onetrust-banner-sdk' } }],
          }],
          methods: [{ name: 'HIDE_CMP', action: { type: 'hide', target: { selector: '#onetrust-banner-sdk' } } }],
        },
      },
    };
    const r = await runEngine(bundle, document);
    expect(r.handled).toBe('realRule');
  });
});
