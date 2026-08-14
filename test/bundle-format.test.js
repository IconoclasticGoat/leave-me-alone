import * as esbuild from 'esbuild';
import { describe, it, expect } from 'vitest';
import { CONTENT_BUILD, MODULE_BUILD } from '../build.config.mjs';

describe('bundle formats', () => {
  it('builds content scripts as iife, never esm', () => {
    expect(CONTENT_BUILD.format).toBe('iife');
    expect(MODULE_BUILD.format).toBe('esm');
  });

  it('emits no top-level export in a content-script bundle', async () => {
    // MV3 content_scripts have no "type": "module" — a top-level export
    // is a SyntaxError that silently disables the entire script.
    const r = await esbuild.build({
      ...CONTENT_BUILD,
      entryPoints: ['src/content/gpc-inject.js'],
      outdir: undefined,
      write: false,
    });
    expect(r.outputFiles[0].text).not.toMatch(/^export[\s{]/m);
  });

  it('emits no top-level export in the main content script bundle', async () => {
    // src/content/index.js is the main content script — it exports
    // createSweeper for testability, but that export must not survive into
    // the iife bundle actually injected into pages. Its silent death would
    // disable the entire product on every site.
    const r = await esbuild.build({
      ...CONTENT_BUILD,
      entryPoints: ['src/content/index.js'],
      outdir: undefined,
      write: false,
    });
    expect(r.outputFiles[0].text).not.toMatch(/^export[\s{]/m);
  });
});
