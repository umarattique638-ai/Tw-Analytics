import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
let tw = '';

beforeAll(() => {
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root, stdio: 'pipe' });
  tw = readFileSync(`${root}dist/cdn/tw.js`, 'utf8');
}, 60_000);

describe('tw.js build (PLAN invariants)', () => {
  it('13: <= 3 KB gzip on the wire', () => {
    expect(gzipSync(tw, { level: 9 }).byteLength).toBeLessThanOrEqual(3072);
  });

  it('5: never registers unload or beforeunload', () => {
    expect(tw).not.toMatch(/["'`](before)?unload["'`]/);
  });

  it('4 + 6: no JSON content type and no custom request headers', () => {
    expect(tw).not.toContain('application/json');
    expect(tw).not.toMatch(/headers\s*:/);
    expect(tw).not.toContain('Authorization');
  });

  it('is self-contained (no imports left in the IIFE)', () => {
    expect(tw).not.toMatch(/\bimport\s*[({"']/);
    expect(tw).not.toContain('require(');
  });

  it('serves with cache headers', () => {
    expect(readFileSync(`${root}dist/cdn/_headers`, 'utf8')).toContain('Cache-Control: public, max-age=3600');
  });
});
