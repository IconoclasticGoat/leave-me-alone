import { getSettings, setSetting, pauseSite, unpauseSite, isPaused } from '../src/settings.js';

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

export function renderToggles(container, settings) {
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

async function init() {
  const settings = await getSettings();
  renderToggles(document.querySelector('#toggles'), settings);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const host = tab?.url ? new URL(tab.url).hostname : null;
  const btn = document.querySelector('#pause');
  if (!host) { btn.hidden = true; return; }

  const paused = isPaused(settings, host);
  btn.textContent = paused ? `Resume on ${host}` : `Pause on ${host}`;
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
