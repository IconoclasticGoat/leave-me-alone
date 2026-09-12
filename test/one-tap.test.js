// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isOneTapPrompt,
  awaitDecision,
  installOneTapGuard,
} from '../src/content/one-tap-guard.js';
import { announceOneTap } from '../src/content/one-tap-inject.js';
import { DECISION_EVENT, DECISION_TIMEOUT_MS } from '../src/content/one-tap-channel.js';

// The options gsi/client actually builds, read off the live library:
//
//   d = {context, providers:[...],
//        mode: Chromium >= 131 ? (c === "button" ? "active" : "passive") : c}
//   e = {signal, federated: d, identity: d}
//   e.mediation = autoReauthn ? "optional" : "required"
//
// One Tap is c === "widget", the Sign in with Google button is c === "button".
// Note that `mediation` splits on auto-reauthn, not on which surface asked —
// it is the same for both and so cannot tell them apart. `mode` is the only
// thing that can.
const provider = { configURL: 'https://accounts.google.com/gsi/fedcm.json', clientId: 'x' };
const gsiCall = (mode, mediation = 'required') => {
  const identity = { context: 'signin', providers: [provider], mode };
  return { signal: new AbortController().signal, identity, federated: identity, mediation };
};

describe('isOneTapPrompt', () => {
  it('recognises the One Tap prompt on current and older Chromium', () => {
    expect(isOneTapPrompt(gsiCall('passive'))).toBe(true);
    expect(isOneTapPrompt(gsiCall('widget'))).toBe(true);
  });

  it('treats a call with no mode as the prompt, per FedCM defaults', () => {
    expect(isOneTapPrompt(gsiCall(undefined))).toBe(true);
  });

  it('leaves the Sign in with Google button alone', () => {
    expect(isOneTapPrompt(gsiCall('active'))).toBe(false);
    expect(isOneTapPrompt(gsiCall('button'))).toBe(false);
  });

  // Regression: the mediation value is the same for the button and the
  // prompt, so anything keying off it blocks both — which is the failure the
  // whole narrowing exercise was trying to undo.
  it('does not key off mediation', () => {
    expect(isOneTapPrompt(gsiCall('active', 'optional'))).toBe(false);
    expect(isOneTapPrompt(gsiCall('passive', 'optional'))).toBe(true);
  });

  it('ignores credential requests that are not federated sign-in', () => {
    expect(isOneTapPrompt({ password: true, mediation: 'required' })).toBe(false);
    expect(isOneTapPrompt({ publicKey: {} })).toBe(false);
    expect(isOneTapPrompt(undefined)).toBe(false);
    expect(isOneTapPrompt({ identity: { providers: [] } })).toBe(false);
  });

  // gsi/client detects FedCM mode support by calling get() with a providerless
  // `identity` whose `mode` is a getter, and treating the getter firing as the
  // answer. Reading `mode` here would fire it without the browser ever having
  // looked, telling the library a lie about the browser it is running in.
  it('does not read mode off gsi/client mode-support probe', () => {
    const read = vi.fn();
    const probe = { identity: Object.defineProperty({}, 'mode', { get: read }) };
    expect(isOneTapPrompt(probe)).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });
});

describe('installOneTapGuard', () => {
  let container, original;

  beforeEach(() => {
    original = vi.fn(async () => 'credential');
    container = Object.create({ get: original });
  });

  it('refuses the One Tap prompt when the toggle is on', async () => {
    installOneTapGuard(container, Promise.resolve(true));
    await expect(container.get(gsiCall('passive'))).rejects.toMatchObject({
      name: 'NetworkError',
    });
    expect(original).not.toHaveBeenCalled();
  });

  it('still lets the Sign in with Google button through', async () => {
    installOneTapGuard(container, Promise.resolve(true));
    await expect(container.get(gsiCall('active'))).resolves.toBe('credential');
    expect(original).toHaveBeenCalledTimes(1);
  });

  // The button's active mode needs transient user activation, which a click
  // only carries for as long as the call stays in the click's own task. A
  // guard that awaited its decision before passing the call on would spend
  // that activation and break the button — the exact breakage that started
  // all this.
  it('passes the button through synchronously, without awaiting the decision', () => {
    installOneTapGuard(container, new Promise(() => {}));
    container.get(gsiCall('active'));
    expect(original).toHaveBeenCalledTimes(1);
  });

  it('leaves password and passkey requests untouched', async () => {
    installOneTapGuard(container, Promise.resolve(true));
    await expect(container.get({ password: true })).resolves.toBe('credential');
    expect(original).toHaveBeenCalledTimes(1);
  });

  it('holds a prompt that arrives before the decision, then refuses it', async () => {
    let decide;
    installOneTapGuard(container, new Promise((r) => { decide = r; }));
    const call = container.get(gsiCall('passive'));
    expect(original).not.toHaveBeenCalled();
    decide(true);
    await expect(call).rejects.toMatchObject({ name: 'NetworkError' });
  });

  it('holds a prompt that arrives before the decision, then allows it', async () => {
    let decide;
    installOneTapGuard(container, new Promise((r) => { decide = r; }));
    const call = container.get(gsiCall('passive'));
    decide(false);
    await expect(call).resolves.toBe('credential');
  });

  it('preserves the receiver and every argument', async () => {
    const seen = vi.fn(function () { return Promise.resolve(this); });
    container = Object.create({ get: seen });
    installOneTapGuard(container, Promise.resolve(true));
    const opts = { password: true };
    await container.get(opts, 'extra');
    expect(seen).toHaveBeenCalledWith(opts, 'extra');
    expect(seen.mock.instances[0]).toBe(container);
  });

  // Off is the default, so this is what happens on almost every page load.
  it('removes itself entirely when the toggle is off', async () => {
    installOneTapGuard(container, Promise.resolve(false));
    await Promise.resolve();
    await Promise.resolve();
    expect(Object.hasOwn(container, 'get')).toBe(false);
    expect(container.get).toBe(original);
  });

  it('does not unwrap another extension that wrapped after it', async () => {
    installOneTapGuard(container, Promise.resolve(false));
    const theirs = () => Promise.resolve('theirs');
    container.get = theirs;
    await Promise.resolve();
    await Promise.resolve();
    expect(container.get).toBe(theirs);
  });

  it('does nothing, and throws nothing, without a credentials container', () => {
    expect(installOneTapGuard(undefined, Promise.resolve(true))).toBe(null);
    expect(installOneTapGuard({}, Promise.resolve(true))).toBe(null);
  });

  it('gives up rather than throwing when get cannot be replaced', () => {
    const frozen = Object.freeze({ get: original });
    expect(installOneTapGuard(frozen, Promise.resolve(true))).toBe(null);
    expect(frozen.get).toBe(original);
  });
});

describe('awaitDecision', () => {
  it('resolves with the answer the injector sends', async () => {
    const p = awaitDecision(window, DECISION_EVENT);
    window.dispatchEvent(new CustomEvent(DECISION_EVENT, { detail: true }));
    await expect(p).resolves.toBe(true);
  });

  // Silence means the injector never got to report — an unsettled storage
  // read, or an extension context invalidated by an update. Blocking on that
  // would break Google sign-in for every user who never turned this on.
  it('fails open when no answer ever arrives', async () => {
    vi.useFakeTimers();
    try {
      const p = awaitDecision(window, DECISION_EVENT, 50);
      vi.advanceTimersByTime(50);
      await expect(p).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives the injector a window wide enough to be worth having', () => {
    expect(DECISION_TIMEOUT_MS).toBeGreaterThanOrEqual(1000);
  });
});

describe('announceOneTap', () => {
  const heard = (settings, hostname) => {
    const seen = [];
    const onEvent = (e) => seen.push(e.detail);
    window.addEventListener(DECISION_EVENT, onEvent);
    try {
      announceOneTap(window, settings, hostname);
    } finally {
      window.removeEventListener(DECISION_EVENT, onEvent);
    }
    return seen;
  };

  it('reports block when the toggle is on', () => {
    expect(heard({ googleOneTap: true }, 'fandom.com')).toEqual([true]);
  });

  // Always answering is what keeps the guard's timeout off the critical path
  // for the default configuration.
  it('reports back even when the toggle is off', () => {
    expect(heard({ googleOneTap: false }, 'fandom.com')).toEqual([false]);
    expect(heard(undefined, 'fandom.com')).toEqual([false]);
  });

  it('reports no block on a paused host or a subdomain of one', () => {
    const paused = { googleOneTap: true, pausedSites: ['fandom.com'] };
    expect(heard(paused, 'fandom.com')).toEqual([false]);
    expect(heard(paused, 'starwars.fandom.com')).toEqual([false]);
    expect(heard(paused, 'example.com')).toEqual([true]);
  });
});

describe('one-tap wiring in the manifest', () => {
  const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
  const scripts = manifest.content_scripts;
  const byFile = (f) => scripts.find((s) => s.js.includes(f));

  // The whole point of the MAIN world here is reaching navigator.credentials
  // before gsi/client calls it. An ISOLATED-world script that injects a
  // <script src> instead — the pattern gpc-inject.js uses — lands tens of
  // milliseconds late, which is fine for a property CMPs read at leisure and
  // useless for a method the page is about to call. See docs/KNOWN-ISSUES.md.
  it('runs the guard in the MAIN world at document_start, in every frame', () => {
    const guard = byFile('one-tap-main.js');
    expect(guard.world).toBe('MAIN');
    expect(guard.run_at).toBe('document_start');
    expect(guard.all_frames).toBe(true);
    expect(guard.matches).toEqual(['<all_urls>']);
  });

  it('runs the injector alongside it, in the isolated world', () => {
    const injector = byFile('one-tap-inject.js');
    expect(injector.world).toBeUndefined();
    expect(injector.run_at).toBe('document_start');
    expect(injector.all_frames).toBe(true);
  });

  // A manifest-declared MAIN-world script is loaded by Chrome directly. Listing
  // it here as well would publish a stable URL for any page to probe for, for
  // no gain — the fingerprinting hole KNOWN-ISSUES.md already records against
  // gpc-main.js.
  it('does not expose the guard as a web-accessible resource', () => {
    const exposed = manifest.web_accessible_resources.flatMap((r) => r.resources);
    expect(exposed).not.toContain('one-tap-main.js');
  });
});
