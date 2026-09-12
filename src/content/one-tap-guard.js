import { DECISION_TIMEOUT_MS } from './one-tap-channel.js';

// Modes that mean "the user asked for this": the Sign in with Google button.
// Chromium >= 131 gets the FedCM spec's "active"; older Chromium is passed
// gsi/client's own older vocabulary ("button"/"widget") unchanged. Anything
// else — including a call with no mode at all, whose FedCM default is
// passive — is the prompt that appears without being asked for.
const ACTIVE_MODES = new Set(['active', 'button']);

/**
 * True when `options` describe a One Tap-style prompt: a federated sign-in
 * the page asks the browser to raise on its own, rather than one a user
 * click started.
 *
 * gsi/client passes the same object as both `identity` (current) and
 * `federated` (legacy), so either key identifies the call.
 */
export function isOneTapPrompt(options) {
  if (!options || typeof options !== 'object') return false;
  const identity = options.identity ?? options.federated;
  if (!identity || typeof identity !== 'object') return false;
  // Checked before `mode` on purpose. gsi/client feature-detects FedCM mode
  // support by passing `{identity: {get mode() {...}}}` with no providers and
  // watching for the getter to fire; reading `mode` here first would fire it
  // from the wrong place. A providerless call cannot raise a prompt anyway.
  if (!Array.isArray(identity.providers) || identity.providers.length === 0) return false;
  return !ACTIVE_MODES.has(identity.mode);
}

/**
 * Resolves to the injector's decision, or to false once `timeoutMs` passes
 * without one. Never rejects.
 */
export function awaitDecision(target, eventName, timeoutMs = DECISION_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const done = (value) => {
      clearTimeout(timer);
      target.removeEventListener(eventName, onEvent);
      resolve(value);
    };
    const onEvent = (e) => done(e.detail === true);
    const timer = setTimeout(() => done(false), timeoutMs);
    target.addEventListener(eventName, onEvent);
  });
}

/**
 * Wraps `container.get` so One Tap prompts are refused once `decision`
 * resolves true. Everything else — the Sign in with Google button, password
 * credentials, anything another library asks for — is passed straight
 * through, synchronously, to the original method.
 *
 * Returns a function that removes the wrapper, or null when there was
 * nothing to wrap.
 */
export function installOneTapGuard(container, decision) {
  if (!container || typeof container.get !== 'function') return null;
  const original = container.get;

  const wrapped = function (...args) {
    if (!isOneTapPrompt(args[0])) return original.apply(this, args);
    // Held, not refused outright: at document_start the decision is still in
    // flight, and answering before it lands would have to guess. Deferring
    // is safe here precisely because this branch only ever sees passive
    // calls, which — unlike the button's active mode — need no transient
    // user activation to survive the wait.
    return decision.then((block) =>
      block
        // What Chrome itself rejects with when a FedCM prompt yields no
        // credential. Deliberately uninformative, and the shape gsi/client
        // already handles: it reports the moment as skipped and moves on.
        ? Promise.reject(new DOMException('Error retrieving a token.', 'NetworkError'))
        : original.apply(this, args)
    );
  };

  const uninstall = () => {
    // Only if ours is still the installed one — another extension may have
    // wrapped `get` after us, and unwrapping to `original` would drop theirs.
    if (container.get === wrapped) delete container.get;
  };

  try {
    container.get = wrapped;
  } catch {
    // `get` is non-writable, or `container` is frozen. Nothing to undo.
    return null;
  }

  // Leave no trace for the overwhelming majority of pages: the toggle is off
  // by default, so on almost every load the honest thing is to hand the page
  // back the method it started with.
  decision.then((block) => {
    if (!block) uninstall();
  });

  return uninstall;
}
