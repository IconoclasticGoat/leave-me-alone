import { queryAll } from './tools.js';

const ON_VALUES = new Set(['true', 'on', 'yes', 'checked', '1']);

function readOnOff(el) {
  if (el.matches('input[type=checkbox], input[type=radio]')) return el.checked;
  const aria = el.getAttribute('aria-checked') ?? el.getAttribute('aria-pressed');
  if (aria != null) return ON_VALUES.has(aria.toLowerCase());
  if (el.hasAttribute('data-checked')) {
    return ON_VALUES.has((el.getAttribute('data-checked') || '').toLowerCase());
  }
  return el.classList.contains('checked') || el.classList.contains('active');
}

const TYPES = {
  css: (c) => ({ matches: (root) => queryAll(root, c.target).length > 0 }),

  checkbox: (c) => ({
    matches: (root) => {
      const el = queryAll(root, c.target)[0];
      return el ? readOnOff(el) : false;
    },
  }),

  onoff: (c) => ({
    matches: (root) => {
      const el = queryAll(root, c.target)[0];
      return el ? readOnOff(el) : false;
    },
  }),

  url: (c) => ({
    matches: () => {
      const filters = c.target?.regex ? [c.target.regex] : (c.target?.urlFilter ?? []);
      const href = globalThis.location?.href ?? '';
      return filters.some((f) => new RegExp(f).test(href));
    },
  }),
};

export function createMatcher(config) {
  const make = TYPES[config?.type];
  if (!make) return { matches: () => false };
  try {
    return make(config);
  } catch {
    return { matches: () => false };
  }
}

export function matchesAll(configs, root) {
  const list = Array.isArray(configs) ? configs : [configs];
  return list.length > 0 && list.every((c) => createMatcher(c).matches(root));
}
