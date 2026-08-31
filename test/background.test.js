import { beforeEach, describe, it, expect, vi } from 'vitest';

// Yield to the macrotask queue, so two concurrent runs would visibly
// interleave rather than each racing through in one microtask drain.
const tick = () => new Promise((r) => setTimeout(r, 0));

// The six types the extension still manages, plus popups and
// automaticDownloads — no longer managed, but applyContentSettings still
// clears them each run to undo a value an older version may have written, so
// the chrome stub must provide them.
const CS_TYPES = [
  'notifications', 'location', 'camera', 'microphone',
  'popups', 'automaticDownloads', 'sound', 'cookies',
];

let trace, listeners, syncStore;

function installChrome() {
  trace = [];
  listeners = { installed: [], startup: [], changed: [], updated: [], activated: [] };
  syncStore = { notifications: true, location: true, pausedSites: ['example.com'] };

  const csType = () => ({
    set: async () => { await tick(); },
    clear: async () => { await tick(); },
  });

  globalThis.chrome = {
    contentSettings: Object.fromEntries(CS_TYPES.map((t) => [t, csType()])),
    declarativeNetRequest: { updateDynamicRules: async () => { await tick(); } },
    action: { setIcon: async () => {}, setTitle: async () => {} },
    tabs: {
      query: async () => [],
      get: async () => null,
      onUpdated: { addListener: (f) => listeners.updated.push(f) },
      onActivated: { addListener: (f) => listeners.activated.push(f) },
    },
    runtime: {
      onInstalled: { addListener: (f) => listeners.installed.push(f) },
      onStartup: { addListener: (f) => listeners.startup.push(f) },
    },
    storage: {
      // getSettings() is the first await of applyAll and storage.local.set is
      // its last, so these two bracket a run.
      sync: { get: async (defaults) => { trace.push('enter'); await tick(); return { ...defaults, ...syncStore }; } },
      local: { set: async () => { trace.push('exit'); } },
      onChanged: { addListener: (f) => listeners.changed.push(f) },
    },
  };
}

async function loadBackground() {
  installChrome();
  vi.resetModules();
  return import('../src/background/index.js');
}

describe('applyAll scheduling', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('runs two rapid schedules one after the other, never overlapped', async () => {
    // Each applyAll is a long awaited sequence of clear → set → per-domain
    // sets across six content-setting types. Concurrent runs interleave and
    // the last writer wins per type, so a stale run can land its value after
    // the fresh one and leave a type enforcing the previous state.
    const { schedule } = await loadBackground();
    schedule();
    await schedule();
    expect(trace).toEqual(['enter', 'exit', 'enter', 'exit']);
  });

  it('serialises three schedules fired in the same turn', async () => {
    const { schedule } = await loadBackground();
    schedule();
    schedule();
    await schedule();
    expect(trace).toEqual(['enter', 'exit', 'enter', 'exit', 'enter', 'exit']);
  });

  it('keeps the queue alive after a run throws', async () => {
    // One failed apply must not wedge every later settings change.
    const { schedule } = await loadBackground();
    chrome.storage.sync.get = async () => { throw new Error('storage gone'); };
    await schedule();
    chrome.storage.sync.get = async (d) => { trace.push('enter'); await tick(); return { ...d, ...syncStore }; };
    await schedule();
    expect(trace).toEqual(['enter', 'exit']);
  });

  it('schedules on a sync settings change, and ignores other areas', async () => {
    // This wiring is what makes every toggle take effect.
    await loadBackground();
    const onChanged = listeners.changed[0];
    onChanged({}, 'local');
    expect(trace).toEqual([]);
    onChanged({}, 'sync');
    onChanged({}, 'sync');
    // Drain the queue the listeners built. The listener returns nothing to
    // await, so poll rather than guess at a duration.
    for (let i = 0; i < 500 && trace.length < 4; i++) await tick();
    expect(trace).toEqual(['enter', 'exit', 'enter', 'exit']);
  });

  it('registers the same scheduler on install and on startup', async () => {
    const { schedule } = await loadBackground();
    expect(listeners.installed[0]).toBe(schedule);
    expect(listeners.startup[0]).toBe(schedule);
  });
});
