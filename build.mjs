import * as esbuild from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';
import { CONTENT_BUILD, MODULE_BUILD } from './build.config.mjs';

mkdirSync('dist', { recursive: true });

await esbuild.build(CONTENT_BUILD);
await esbuild.build(MODULE_BUILD);

for (const f of ['manifest.json', 'icons', 'popup/popup.html', 'popup/popup.css']) {
  cpSync(f, `dist/${f}`, { recursive: true });
}
console.log('built dist/');
