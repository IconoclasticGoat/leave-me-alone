import { readFileSync, existsSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const SIZES = [16, 32, 48, 128];
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe('icon assets', () => {
  for (const variant of ['active', 'paused']) {
    for (const size of SIZES) {
      const path = `icons/${variant}-${size}.png`;

      it(`ships ${path} as a real PNG`, () => {
        expect(existsSync(path)).toBe(true);
        const buf = readFileSync(path);
        expect(buf.subarray(0, 4)).toEqual(PNG_MAGIC);
        // Width lives in bytes 16-20 of the IHDR chunk, big-endian.
        expect(buf.readUInt32BE(16)).toBe(size);
      });
    }
  }

  it('draws the paused bar rotated and the active bar level', () => {
    // The rotation is the whole signal — if a refactor drops the transform,
    // the two icons become distinguishable only by colour, which fails for
    // colourblind users and in greyscale.
    expect(readFileSync('assets/icon-paused.svg', 'utf8')).toContain('rotate(-30 24 24)');
    expect(readFileSync('assets/icon.svg', 'utf8')).not.toContain('rotate');
  });
});
