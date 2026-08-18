// ISOLATED world, document_start
import { getSettings } from '../settings.js';

const MARKER = 'data-lma-gpc';

export function injectGpc(doc, settings) {
  if (!settings?.gpc) return null;
  if (doc.querySelector(`script[${MARKER}]`)) return null;

  const el = doc.createElement('script');
  el.setAttribute(MARKER, '');
  el.src = chrome.runtime.getURL('gpc-main.js');
  // Remove the tag once it has run; the property it sets persists.
  el.onload = () => el.remove();
  (doc.head ?? doc.documentElement).appendChild(el);
  return el;
}

async function main() {
  injectGpc(document, await getSettings());
}

if (typeof chrome !== 'undefined' && chrome.storage) main();
