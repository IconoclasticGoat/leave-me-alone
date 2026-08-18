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
