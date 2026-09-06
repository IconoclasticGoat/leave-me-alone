import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LIST = 'https://raw.githubusercontent.com/cavi-au/Consent-O-Matic/master/rules-list.json';
const REPO = 'https://github.com/cavi-au/Consent-O-Matic';
// Rules of our own, in the same schema, for CMPs upstream does not cover.
// Bundled after the vendored set so a local rule wins a name collision.
const LOCAL = 'src/rules/local';

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
const vendored = Object.keys(rules).length;

const local = [];
for (const file of readdirSync(LOCAL).filter((f) => f.endsWith('.json')).sort()) {
  const body = JSON.parse(readFileSync(join(LOCAL, file), 'utf8'));
  delete body.$schema;
  Object.assign(rules, body);
  local.push(...Object.keys(body));
}

mkdirSync('src/rules', { recursive: true });
const bundle = {
  version: new Date().toISOString().slice(0, 10),
  source: `${REPO} (MIT)`,
  local,
  rules,
};
writeFileSync('src/rules/bundle.json', JSON.stringify(bundle));
console.log(`bundled ${vendored} CMPs from upstream plus ${local.length} local: ${local.join(', ')}`);
