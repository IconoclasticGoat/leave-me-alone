import { readFileSync, existsSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const PATH = 'src/rules/bundle.json';

describe('rule bundle', () => {
  it('exists — run `npm run bundle-rules` if this fails', () => {
    expect(existsSync(PATH)).toBe(true);
  });

  const b = JSON.parse(readFileSync(PATH, 'utf8'));

  it('carries provenance', () => {
    expect(b.version).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(b.source).toContain('Consent-O-Matic');
  });

  it('covers the major CMPs', () => {
    for (const n of ['onetrust', 'cookiebot', 'didomi.io', 'quantcast', 'usercentrics']) {
      expect(Object.keys(b.rules).some((k) => k.toLowerCase().includes(n.split('.')[0]))).toBe(true);
    }
  });

  it('has stripped $schema keys', () => {
    expect(JSON.stringify(b.rules)).not.toContain('$schema');
  });

  it('every rule has detectors and methods', () => {
    for (const [name, r] of Object.entries(b.rules)) {
      expect(Array.isArray(r.detectors), `${name} detectors`).toBe(true);
      expect(Array.isArray(r.methods), `${name} methods`).toBe(true);
    }
  });
});
