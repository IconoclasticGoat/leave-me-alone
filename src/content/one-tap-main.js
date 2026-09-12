// Runs in the page's MAIN world at document_start.
//
// Google One Tap is no longer an iframe. Since the FedCM migration,
// gsi/client raises the prompt by calling
// navigator.credentials.get({identity: {providers: [...], mode: "passive"}}),
// and the card is drawn by the browser. Nothing the page fetches carries it,
// so declarativeNetRequest has nothing to block — see docs/KNOWN-ISSUES.md.
// The call itself is the only place left to stop it, and reaching that call
// means running in the page's own world, before its scripts do.
import { DECISION_EVENT } from './one-tap-channel.js';
import { awaitDecision, installOneTapGuard } from './one-tap-guard.js';

installOneTapGuard(navigator.credentials, awaitDecision(window, DECISION_EVENT));
