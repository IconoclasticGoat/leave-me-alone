import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const DOC = 'docs/STORE-LISTING.md';

// <!-- field: name max: 75 --> followed by a fenced block.
const FIELD_RE = /<!--\s*field:\s*(\w+)\s+max:\s*(\d+)[^>]*-->\s*```\n([\s\S]*?)\n```/g;

export function parseFields(markdown) {
  return [...markdown.matchAll(FIELD_RE)].map(([, name, max, body]) => ({
    name,
    max: Number(max),
    body,
  }));
}

describe('store listing copy', () => {
  const fields = parseFields(readFileSync(DOC, 'utf8'));

  it('finds every field the submission form asks for', () => {
    // A field silently missing from the doc would also be silently missing
    // from its length check, which is the one thing this file exists to do.
    expect(fields.map((f) => f.name)).toEqual([
      'name',
      'short_description',
      'detailed_description',
      'single_purpose',
      'justification_storage',
      'justification_contentSettings',
      'justification_declarativeNetRequestWithHostAccess',
      'justification_host_permissions',
      'justification_remote_code',
    ]);
  });

  for (const { name, max, body } of fields) {
    it(`fits ${name} in ${max} characters`, () => {
      expect(body.length).toBeLessThanOrEqual(max);
    });

    it(`leaves no placeholder in ${name}`, () => {
      expect(body.trim()).not.toBe('');
      expect(body).not.toMatch(/\bTBD\b|\bTODO\b|XXX|Lorem ipsum/i);
    });
  }

  it('justifies every permission the manifest actually requests', () => {
    // The store asks for one justification per permission. A permission added
    // to the manifest without a matching justification here is a submission
    // that comes back rejected, days later, for a missing text box.
    const m = JSON.parse(readFileSync('manifest.json', 'utf8'));
    const justified = new Set(
      fields
        .map((f) => f.name.match(/^justification_(.+)$/)?.[1])
        .filter(Boolean)
    );

    for (const permission of m.permissions) {
      expect(justified).toContain(permission);
    }
    if (m.host_permissions?.length) {
      expect(justified).toContain('host_permissions');
    }
  });
});
