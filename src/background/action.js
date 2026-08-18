import { isPaused } from '../settings.js';

const SIZES = [16, 32, 48, 128];

const pathsFor = (variant) =>
  Object.fromEntries(SIZES.map((s) => [s, `icons/${variant}-${s}.png`]));

const ACTIVE = pathsFor('active');
const PAUSED = pathsFor('paused');

export function hostnameOf(url) {
  try {
    const parsed = new URL(url);
    // Only http(s) URLs have meaningful hostnames for pause enforcement.
    if (!parsed.protocol.startsWith('http')) {
      return null;
    }
    return parsed.hostname || null;
  } catch {
    // chrome://, about:blank, undefined during teardown — all mean
    // "no site here", which is not an error.
    return null;
  }
}

export function actionStateFor(settings, url) {
  const host = hostnameOf(url);
  if (host && isPaused(settings, host)) {
    return { path: PAUSED, title: `Leave Me Alone — paused on ${host}` };
  }
  return { path: ACTIVE, title: 'Leave Me Alone' };
}

export async function stampTab(tabId, url, settings) {
  const { path, title } = actionStateFor(settings, url);
  try {
    await Promise.all([
      chrome.action.setIcon({ tabId, path }),
      chrome.action.setTitle({ tabId, title }),
    ]);
  } catch {
    // The tab closed between the event and this call. Routine.
  }
}

export async function stampAllTabs(settings) {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs
      .filter((t) => t.id !== undefined && t.url)
      .map((t) => stampTab(t.id, t.url, settings))
  );
}
