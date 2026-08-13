import * as esbuild from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });

await esbuild.build({
  entryPoints: {
    background: 'src/background/index.js',
    content: 'src/content/index.js',
    'popup/popup': 'popup/popup.js',
  },
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  outdir: 'dist',
  loader: { '.json': 'json' },
});

for (const f of ['manifest.json', 'rules', 'popup/popup.html', 'popup/popup.css']) {
  cpSync(f, `dist/${f}`, { recursive: true });
}
console.log('built dist/');
