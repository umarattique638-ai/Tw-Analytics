import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { queriesMarkdown } from '../src/queries-doc';

/** docs/QUERIES.md must list the exact SQL the dashboard runs. TW_UPDATE_DOCS=1 rewrites it. */
const file = new URL('../../../docs/QUERIES.md', import.meta.url);

describe('docs/QUERIES.md', () => {
  it('is identical to the queries in apps/api/src/stats.ts', () => {
    const want = queriesMarkdown();
    if (process.env.TW_UPDATE_DOCS === '1' || !existsSync(file)) writeFileSync(file, want);
    expect(readFileSync(file, 'utf8')).toBe(want);
  });
});
