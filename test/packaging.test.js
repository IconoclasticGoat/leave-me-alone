import { existsSync, readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { COPY } from '../build.config.mjs';

describe('packaging', () => {
  // The Web Store zip is built from dist/, and dist/ contains only what COPY
  // names. Dropping either notice from that list would ship a distribution
  // that violates the MIT terms on the vendored Consent-O-Matic rules — a
  // silent, invisible regression that no other test would catch.
  for (const notice of ['LICENSE', 'THIRD_PARTY.md']) {
    it(`ships ${notice} with the built extension`, () => {
      expect(COPY).toContain(notice);
      expect(existsSync(notice)).toBe(true);
    });
  }

  it('keeps the manifest version in step with package.json', () => {
    // `npm run package` names the zip after the package.json version while
    // the store reads the manifest version. If they drift, the uploaded file
    // is labelled with a version the store never sees.
    const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(manifest.version).toBe(pkg.version);
  });
});
