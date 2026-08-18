import { getSettings, setSetting, pauseSite, unpauseSite, isPaused, isPausableHost } from '../src/settings.js';

export const TOGGLE_GROUPS = {
  primary: [
    { key: 'cookieBanners', label: 'Reject cookie banners' },
    { key: 'notifications', label: 'Block notification prompts' },
    { key: 'location',      label: 'Block location requests' },
    { key: 'newsletters',   label: 'Dismiss newsletter popups' },
  ],
  more: [
    { key: 'gpc',             label: 'Send Global Privacy Control' },
    { key: 'cameraMic',       label: 'Block camera & microphone prompts' },
    { key: 'popupsDownloads', label: 'Block popups & automatic downloads' },
    { key: 'autoplaySound',   label: 'Block autoplaying sound' },
    { key: 'chatWidgets',     label: 'Hide chat bubbles' },
    { key: 'googleOneTap',    label: 'Block Google one-tap sign-in' },
    { key: 'sessionOnlyCookies', label: 'Delete all cookies on quit',
      warning: 'You will be logged out of every site each time you close Chrome.' },
  ],
};

export function renderToggles(container, settings, { disabled = false } = {}) {
  container.textContent = '';
  for (const [group, toggles] of Object.entries(TOGGLE_GROUPS)) {
    const section = document.createElement('section');
    section.className = group;
    for (const t of toggles) {
      const row = document.createElement('label');
      row.className = 'row';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = `toggle-${t.key}`;
      input.checked = Boolean(settings[t.key]);
      input.disabled = disabled;
      input.addEventListener('change', () => setSetting(t.key, input.checked));

      const span = document.createElement('span');
      span.textContent = t.label;

      row.append(input, span);
      if (t.warning) {
        const w = document.createElement('small');
        w.className = 'warning';
        w.textContent = t.warning;
        row.append(w);
      }
      section.append(row);
    }
    container.append(section);
  }
}

/**
 * Paints the paused banner and positions the single pause/resume button.
 * Kept separate from init() so it can be tested without stubbing chrome.tabs.
 */
export function applyPausedState(doc, host, paused) {
  const btn = doc.querySelector('#pause');
  const status = doc.querySelector('#status');
  status.textContent = '';
  btn.textContent = paused ? `Resume on ${host}` : `Pause on ${host}`;
  btn.classList.toggle('primary', paused);
  if (!paused) return;

  const banner = doc.createElement('div');
  banner.className = 'banner';

  const icon = doc.createElement('img');
  icon.src = '../icons/paused-48.png';
  icon.width = 26;
  icon.height = 26;
  icon.alt = '';

  const text = doc.createElement('div');
  const title = doc.createElement('div');
  title.className = 'banner-title';
  title.textContent = `Paused on ${host}`;
  const detail = doc.createElement('div');
  detail.className = 'banner-detail';
  detail.textContent =
    'Nothing is being blocked here. Cookie banners, prompts, and trackers all behave as the site intends.';
  text.append(title, detail);

  banner.append(icon, text);
  status.append(banner, btn);
}

async function init() {
  const settings = await getSettings();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const host = tab?.url ? new URL(tab.url).hostname : null;
  const paused = host ? isPaused(settings, host) : false;

  const container = document.querySelector('#toggles');
  renderToggles(container, settings, { disabled: paused });
  container.classList.toggle('paused-toggles', paused);

  const btn = document.querySelector('#pause');
  // No host, or a host pauseSite would refuse to store (a failed navigation
  // can leave "http://*.com/" on the tab, which URL parses happily). Offering
  // a button that silently does nothing is worse than offering none.
  if (!host || !isPausableHost(host)) { btn.hidden = true; return; }

  applyPausedState(document, host, paused);
  btn.addEventListener('click', async () => {
    await (paused ? unpauseSite(host) : pauseSite(host));
    window.close();
  });

  const { lastApplyErrors = [] } = await chrome.storage.local.get({ lastApplyErrors: [] });
  markUnenforced(document, lastApplyErrors);
}

/** Marks the toggles Chrome refused to enforce, by their settingKey. */
export function markUnenforced(doc, failures = []) {
  const keys = [...new Set(failures.map((f) => f.settingKey))];
  if (keys.length === 0) return;

  const all = [...TOGGLE_GROUPS.primary, ...TOGGLE_GROUPS.more];
  for (const key of keys) {
    doc.querySelector(`#toggle-${key}`)?.closest('.row')?.classList.add('unenforced');
  }
  const labels = keys.map((k) => all.find((t) => t.key === k)?.label ?? k);
  doc.querySelector('#errors').textContent =
    `This Chrome version can't enforce: ${labels.join(', ')}`;
}

if (typeof document !== 'undefined' && document.querySelector('#toggles')) init();
