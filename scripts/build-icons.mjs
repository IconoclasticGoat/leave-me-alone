// Rasterises the two icon sources to the PNG sizes Chrome needs. The
// generated PNGs are committed, so `npm run build` never needs resvg —
// only `npm run icons` does, and only when the artwork changes.
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const SIZES = [16, 32, 48, 128];
const VARIANTS = [
  ['active', 'assets/icon.svg'],
  ['paused', 'assets/icon-paused.svg'],
];

mkdirSync('icons', { recursive: true });

for (const [name, src] of VARIANTS) {
  const svg = readFileSync(src, 'utf8');
  for (const size of SIZES) {
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } })
      .render()
      .asPng();
    writeFileSync(`icons/${name}-${size}.png`, png);
    console.log(`icons/${name}-${size}.png`);
  }
}
