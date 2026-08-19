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
    { key: 'popupsDownloads', label: 'Block popups & automatic downloads' },
    { key: 'cameraMic',       label: 'Block camera & microphone prompts' },
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

/**
 * Exported for tests: the popup's whole tab-dependent wiring lives here, and
 * it is the only place the paused host and the failure report meet.
 */
export async function init() {
  const settings = await getSettings();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const host = tab?.url ? new URL(tab.url).hostname : null;
  const paused = host ? isPaused(settings, host) : false;

  const container = document.querySelector('#toggles');
  renderToggles(container, settings, { disabled: paused });
  container.classList.toggle('paused-toggles', paused);

  const btn = document.querySelector('#pause');
  // Pausing needs a host pauseSite will actually store — a failed navigation
  // can leave "http://*.com/" on the tab, which URL parses happily, and a
  // button that silently does nothing is worse than no button. Resuming only
  // needs the host to match something already stored, which a value synced
  // from an older build can be while being unstorable today. Gating both on
  // isPausableHost stranded that user: disabled toggles, no banner, no way
  // back.
  const canAct = Boolean(host) && (paused || isPausableHost(host));
  btn.hidden = !canAct;
  if (canAct) {
    applyPausedState(document, host, paused);
    btn.addEventListener('click', async () => {
      await (paused ? unpauseSite(host) : pauseSite(host));
      window.close();
    });
  }

  // Outside that branch on purpose: a host with no pause button still needs
  // the report of what the last apply could not enforce.
  const { lastApplyErrors = [] } = await chrome.storage.local.get({ lastApplyErrors: [] });
  markUnenforced(document, lastApplyErrors);
}

// applyContentSettings reports a per-domain pattern rejection with the
// offending pattern appended, which is what separates it from a whole-type
// failure.
const PATTERN_RE = /\(pattern (.+)\)$/;

// 'http://*.192.168.1.1/*' -> '192.168.1.1'
const domainOf = (pattern) =>
  pattern.replace(/^\w+:\/\//, '').replace(/^\*\./, '').replace(/\/\*$/, '');

const labelFor = (key) =>
  [...TOGGLE_GROUPS.primary, ...TOGGLE_GROUPS.more]
    .find((t) => t.key === key)?.label ?? key;

const uniq = (xs) => [...new Set(xs)];

/**
 * Reports what didn't apply, and marks the rows responsible.
 *
 * Two unrelated failures arrive through the one list and mean opposite
 * things. A whole-type failure means the toggle is doing nothing at all —
 * `sound` needs Chrome 141+, and the Chrome version really is the cause. A
 * per-domain failure means Chrome refused the match pattern for one paused
 * site: the toggle is working exactly as it says, and it is the *pause* that
 * did not take, so that one site is still being blocked while the toolbar
 * icon calls it paused. Reporting both as "this Chrome version can't
 * enforce" was true of only the first kind.
 */
export function markUnenforced(doc, failures = []) {
  const errors = doc.querySelector('#errors');
  errors.textContent = '';
  for (const row of doc.querySelectorAll('.unenforced, .pause-unapplied')) {
    row.classList.remove('unenforced', 'pause-unapplied');
  }

  const pattern = failures.filter((f) => PATTERN_RE.test(f.error ?? ''));
  const version = failures.filter((f) => !PATTERN_RE.test(f.error ?? ''));

  // `.unenforced` dims a row to say "this switch is doing nothing", which is
  // only true of the version kind. A pattern failure gets its own mark so
  // the row is still findable without claiming the toggle is dead.
  const report = (klass, entries, sentence) => {
    const keys = uniq(entries.map((f) => f.settingKey));
    if (keys.length === 0) return;
    for (const key of keys) {
      doc.querySelector(`#toggle-${key}`)?.closest('.row')?.classList.add(klass);
    }
    const line = doc.createElement('div');
    line.textContent = sentence(keys.map(labelFor), entries);
    errors.append(line);
  };

  report('unenforced', version, (labels) =>
    `This Chrome version can't enforce: ${labels.join(', ')}`);

  report('pause-unapplied', pattern, (labels, entries) => {
    const domains = uniq(entries.map((f) => domainOf(f.error.match(PATTERN_RE)[1])));
    return `Chrome refused the pause exception for ${domains.join(', ')}, `
      + `so these still apply there: ${labels.join(', ')}`;
  });
}

if (typeof document !== 'undefined' && document.querySelector('#toggles')) init();
