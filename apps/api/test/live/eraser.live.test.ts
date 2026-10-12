import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClickHouseClient } from '../../src/analytics';
import { ClickHouseEraser, totalOf } from '../../src/eraser';
import type { RowCounts } from '../../src/eraser';
import { retentionCutoff } from '../../src/jobs';
import { StatsReader } from '../../src/stats';

/**
 * Phase 3 on a REAL ClickHouse: retention pruning and account erasure delete exactly the right rows, with
 * a user that has ONLY the grants of infra/clickhouse/004_prune_user.sql, and the account export reads
 * the whole stored history.
 *
 * Run: pnpm --filter @tailwatch/api live     (TW_CH_URL / TW_CH_USER / TW_CH_PASSWORD: an admin)
 */
const env = fileURLToPath(new URL('../../../../.env', import.meta.url));
if (existsSync(env)) process.loadEnvFile(env);
const URL_ = process.env.TW_CH_URL?.replace(/\/+$/, '');
const USER = process.env.TW_CH_USER ?? 'default';
const PASSWORD = process.env.TW_CH_PASSWORD ?? '';
const STAMP = Date.now();
const DB = `tw_erase_${STAMP}`;
const OTHER = `tw_other_${STAMP}`;
const PRUNER = `tw_prune_test_${STAMP}`;
const PRUNER_PASSWORD = `Pr-${STAMP}-only-for-this-test`;

async function sql(statement: string, body?: string): Promise<string> {
  const qs = new URLSearchParams({ select_sequential_consistency: '1' });
  if (body !== undefined) qs.set('query', statement);
  const res = await fetch(`${URL_}/?${qs}`, { method: 'POST', headers: { 'X-ClickHouse-User': USER, 'X-ClickHouse-Key': PASSWORD }, body: body ?? statement });
  const text = await res.text();
  if (!res.ok) throw new Error(`ClickHouse ${res.status}: ${text.slice(0, 300)}`);
  return text;
}
const insert = (table: string, rows: object[]) => sql(`INSERT INTO ${DB}.${table} FORMAT JSONEachRow`, rows.map((r) => JSON.stringify(r)).join('\n'));
const ts = (d: Date) => d.toISOString().replace('T', ' ').replace('Z', '');

const NOW = new Date();
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const A = 501; // retention 30 days
const B = 502; // retention 395 days
const C = 503; // another account: erasure must not touch it

let eraser: ClickHouseEraser;

function ev(site: number, at: Date, visitor: number, path = '/') {
  return { site_id: site, insert_id: `${site}-${at.getTime()}-${visitor}`, name: 'pageview', timestamp: ts(at), received_at: ts(at), pathname: path, visitor_hash: visitor, session_id: visitor, seq: 1 };
}
const session = (site: number, at: Date, visitor: number) => ({ site_id: site, session_id: visitor, visitor_hash: visitor, start: ts(at), last_seen: ts(at), pageviews: 1, sign: 1, version: 1 });
const drop = (site: number, at: Date) => ({ site_id: site, at: ts(at), reason: 'bot', detail: '', hits: 1 });

/** Mutations run in the background: wait until the count matches (or give up after 20 s). */
async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 80; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('mutation did not finish in time');
}
const count = (c: RowCounts, t: keyof RowCounts, site: number) => c[t].get(site) ?? 0;

beforeAll(async () => {
  if (!URL_) return;
  const ddl = readFileSync(new URL('../../../../infra/clickhouse/001_contract.sql', import.meta.url), 'utf8');
  for (const statement of ddl.replace(/^--.*$/gm, '').replaceAll('tailwatch', DB).split(';').map((s) => s.trim()).filter(Boolean)) await sql(statement);
  // The pruning user with exactly the grants of 004_prune_user.sql (database and name swapped for this run).
  const grants = readFileSync(new URL('../../../../infra/clickhouse/004_prune_user.sql', import.meta.url), 'utf8')
    .replace(/^--.*$/gm, '')
    .replaceAll('tailwatch.', `${DB}.`)
    .replaceAll('tw_prune', PRUNER)
    .replace('REPLACE_WITH_A_LONG_RANDOM_PASSWORD', PRUNER_PASSWORD);
  for (const statement of grants.split(';').map((s) => s.trim()).filter(Boolean)) await sql(statement);
  eraser = new ClickHouseEraser(new ClickHouseClient(URL_, PRUNER, PRUNER_PASSWORD, DB, fetch, { sequentialConsistency: true }));

  const events = [];
  for (const site of [A, B, C]) {
    for (const days of [1, 20, 40, 200, 400]) events.push(ev(site, ago(days), days, `/p${days}`));
  }
  await insert('events', events); // the rollup MV fills rollup_15m_pages from these
  await insert('sessions', [A, B, C].flatMap((site) => [session(site, ago(1), 1), session(site, ago(40), 40)]));
  await insert('dropped_hits', [A, B, C].flatMap((site) => [drop(site, ago(1)), drop(site, ago(40))]));
  await sql(`CREATE DATABASE IF NOT EXISTS ${OTHER}`);
  await sql(`CREATE TABLE ${OTHER}.secrets (x UInt8) ENGINE = MergeTree ORDER BY x`);
}, 120_000);

afterAll(async () => {
  if (!URL_) return;
  await sql(`DROP USER IF EXISTS ${PRUNER}`);
  await sql(`DROP DATABASE IF EXISTS ${DB}`);
  await sql(`DROP DATABASE IF EXISTS ${OTHER}`);
});

describe.skipIf(!URL_)('retention + erasure on a real ClickHouse (tw_prune grants only)', () => {
  it('counts per table and site, all rows and rows older than a cutoff (DateTime64 and DateTime columns)', async () => {
    const all = await eraser.count([A, B], null);
    expect(count(all, 'events', A)).toBe(5);
    expect(count(all, 'rollup_15m_pages', A)).toBe(5);
    expect(count(all, 'sessions', B)).toBe(2);
    expect(count(all, 'dropped_hits', B)).toBe(2);
    expect(all.events.has(C)).toBe(false);
    const old = await eraser.count([A], retentionCutoff(NOW, 30));
    expect([count(old, 'events', A), count(old, 'rollup_15m_pages', A), count(old, 'sessions', A), count(old, 'dropped_hits', A)]).toEqual([3, 3, 1, 1]);
  });

  it('retention: deletes only rows older than the cutoff, only of those sites', async () => {
    const cutA = retentionCutoff(NOW, 30);
    const cutB = retentionCutoff(NOW, 395);
    await eraser.remove([A], cutA, ['events', 'sessions', 'dropped_hits', 'rollup_15m_pages']);
    await eraser.remove([B], cutB, ['events', 'rollup_15m_pages']);
    await until(async () => totalOf(await eraser.count([A], cutA)) === 0 && totalOf(await eraser.count([B], cutB)) === 0);
    const left = await eraser.count([A, B, C], null);
    expect([count(left, 'events', A), count(left, 'rollup_15m_pages', A), count(left, 'sessions', A), count(left, 'dropped_hits', A)]).toEqual([2, 2, 1, 1]);
    expect(count(left, 'events', B)).toBe(4); // only the 400-day-old row went
    expect(count(left, 'events', C)).toBe(5);
  });

  it('the account export reads the stored history per local day (pages_all, series, events)', async () => {
    const stats = new StatsReader(new ClickHouseClient(URL_!, USER, PASSWORD, DB, fetch, { sequentialConsistency: true }));
    const to = NOW.toISOString().slice(0, 10);
    const from = new Date(NOW.getTime() - 395 * DAY).toISOString().slice(0, 10);
    const x = await stats.exportSite(C, 'UTC', from, to);
    expect(x.days.reduce((n, d) => n + d.pageviews, 0)).toBe(4); // 1, 20, 40, 200 days ago; 400 is outside
    expect(x.pages.map((p) => p.path).sort()).toEqual(['/p1', '/p20', '/p200', '/p40']);
    expect(x.events).toEqual([{ name: 'pageview', count: 4, lastAt: expect.any(String) }]);
    expect(x.days.find((d) => d.date === ago(1).toISOString().slice(0, 10))?.sessions).toBe(1);
  });

  it('erasure: every row of the deleted sites goes, another account keeps everything', async () => {
    await eraser.remove([A, B], null, ['events', 'sessions', 'dropped_hits', 'rollup_15m_pages']);
    await until(async () => totalOf(await eraser.count([A, B], null)) === 0);
    const c = await eraser.count([C], null);
    expect([count(c, 'events', C), count(c, 'sessions', C), count(c, 'dropped_hits', C), count(c, 'rollup_15m_pages', C)]).toEqual([5, 2, 2, 5]);
  });

  it('the pruning user cannot insert, read other databases, or change the schema', async () => {
    const as = (q: string) => fetch(`${URL_}/`, { method: 'POST', headers: { 'X-ClickHouse-User': PRUNER, 'X-ClickHouse-Key': PRUNER_PASSWORD }, body: q });
    expect((await as(`INSERT INTO ${DB}.dropped_hits (site_id, at, reason, hits) VALUES (1, now(), 'x', 1)`)).status).not.toBe(200);
    expect((await as(`ALTER TABLE ${DB}.events DROP COLUMN props`)).status).not.toBe(200);
    expect((await as(`DROP TABLE ${DB}.events`)).status).not.toBe(200);
    expect((await as(`ALTER TABLE ${DB}.events UPDATE pathname = '/' WHERE 1`)).status).not.toBe(200);
    expect((await as(`SELECT count() FROM ${OTHER}.secrets`)).status).not.toBe(200);
    expect((await as(`ALTER TABLE ${OTHER}.secrets DELETE WHERE 1`)).status).not.toBe(200);
    expect((await as(`SELECT count() FROM ${DB}.events`)).status).toBe(200); // and the allowed read works
  });
});
