export const SHARED = {
  bundle: true,
  target: 'chrome120',
  outdir: 'dist',
  loader: { '.json': 'json' },
};

// Injected into pages as classic scripts. MUST be iife — a top-level
// `export` here is a SyntaxError that silently disables the whole script.
export const CONTENT_BUILD = {
  ...SHARED,
  format: 'iife',
  entryPoints: {
    content: 'src/content/index.js',
    'gpc-inject': 'src/content/gpc-inject.js',
    'gpc-main': 'src/content/gpc-main.js',
    'one-tap-inject': 'src/content/one-tap-inject.js',
    'one-tap-main': 'src/content/one-tap-main.js',
  },
};

// Loaded as real modules by Chrome; ESM is correct here.
export const MODULE_BUILD = {
  ...SHARED,
  format: 'esm',
  entryPoints: {
    background: 'src/background/index.js',
    'popup/popup': 'popup/popup.js',
  },
};

// Copied verbatim into dist/. THIRD_PARTY.md and LICENSE are not optional:
// the vendored Consent-O-Matic rules are MIT, which requires the notice to
// travel with every distributed copy — and the Web Store zip is built from
// dist/, so a file missing here is a file missing from what users receive.
export const COPY = [
  'manifest.json',
  'icons',
  'popup/popup.html',
  'popup/popup.css',
  'THIRD_PARTY.md',
  'LICENSE',
];
