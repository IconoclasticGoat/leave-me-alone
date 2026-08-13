import { mkdirSync, writeFileSync } from 'node:fs';

const LIST = 'https://raw.githubusercontent.com/cavi-au/Consent-O-Matic/master/rules-list.json';
const REPO = 'https://github.com/cavi-au/Consent-O-Matic';

const { references } = await (await fetch(LIST)).json();
console.log(`fetching ${references.length} rule files...`);

const rules = {};
for (const url of references) {
  const res = await fetch(url);
  if (!res.ok) { console.warn(`skip ${url}: ${res.status}`); continue; }
  const body = await res.json();
  delete body.$schema;
  Object.assign(rules, body);
}

mkdirSync('src/rules', { recursive: true });
const bundle = {
  version: new Date().toISOString().slice(0, 10),
  source: `${REPO} (MIT)`,
  rules,
};
writeFileSync('src/rules/bundle.json', JSON.stringify(bundle));
console.log(`bundled ${Object.keys(rules).length} CMPs`);
