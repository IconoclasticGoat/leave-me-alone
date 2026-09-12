// Shared by the ISOLATED-world injector and the MAIN-world guard, which have
// no other way to reach each other: a MAIN-world content script cannot read
// chrome.storage, and an ISOLATED-world one cannot patch the page's
// navigator.credentials. The DOM event is the only channel they both have.
export const DECISION_EVENT = 'lma-one-tap-decision';

// How long the guard holds a One Tap call before giving up on hearing from
// the injector and letting it through. Only reached when the injector never
// reports — a storage read that never settles, or an invalidated extension
// context after an update. Failing open matters more than failing closed:
// the toggle is off by default, so a guard that blocked on silence would
// break Google sign-in for everyone who never turned this on.
export const DECISION_TIMEOUT_MS = 3000;
