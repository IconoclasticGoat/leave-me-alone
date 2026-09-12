// ISOLATED world, document_start. Reads the toggle the MAIN-world guard
// cannot see and reports it across.
import { getSettings, isPaused } from '../settings.js';
import { DECISION_EVENT } from './one-tap-channel.js';

/**
 * Tells the MAIN-world guard whether to block One Tap on this page. Always
 * dispatches, including when the answer is no — silence is what the guard's
 * timeout is for, and spending it on the ordinary case would stall the first
 * prompt on every page for three seconds.
 */
export function announceOneTap(target, settings, hostname = location.hostname) {
  const block = Boolean(settings?.googleOneTap) && !isPaused(settings, hostname);
  target.dispatchEvent(new CustomEvent(DECISION_EVENT, { detail: block }));
  return block;
}

async function main() {
  // The await guarantees this lands after every document_start content
  // script body has run, so the guard is already listening.
  announceOneTap(window, await getSettings());
}

if (typeof chrome !== 'undefined' && chrome.storage) main();
