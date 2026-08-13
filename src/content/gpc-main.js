// Runs in the page's MAIN world.
// Standalone by design: bundled as its own entry, no imports.
try {
  Object.defineProperty(navigator, 'globalPrivacyControl', {
    value: true,
    configurable: false,
    enumerable: true,
  });
} catch {
  // Another extension may have defined it already. Theirs is equivalent; leave it.
}
