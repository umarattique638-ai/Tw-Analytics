import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { wireQueueMessages, sessionQueueMessages } from '../../../../packages/contract/fixtures/queue';
import { sessionExpected } from '../../../../packages/contract/fixtures/sessions';
import { FIXTURE_IP } from '../../../../packages/contract/fixtures/payloads';
import { createClickHousePort } from '../../src/adapters/clickhouse';
import { processBatch } from '../../src/process';
import type { ClickHousePort, ClickHouseTable, InboundMessage, StatePort } from '../../src/process';
import { createMemoryState } from '../../src/state/memory';

/**
 * Stage 3 done-when, against a REAL ClickHouse (ClickHouse Cloud or local). Run: pnpm --filter @tailwatch/consumer live
 * It is not part of `pnpm test`. Settings come from the repository-root .env:
 *
 *   TW_CH_URL       default http://127.0.0.1:8123 (a local server); or https://<service>.clickhouse.cloud:8443
 *   TW_CH_USER      default "default"
 *   TW_CH_PASSWORD  default ""
 *
 * It never touches the real `tailwatch` database: it creates tw_stage3_<time>, applies
 * infra/clickhouse/001_contract.sql into it, and drops it at the end.
 *
 * Proves (BUILD-ORDER Stage 3):
 *   1. fixtures in -> correct rows out (every value ClickHouse stored equals what the consumer sent)
 *   2. the session fixture gives exactly the frozen Stage 1 metrics IN THE DATABASE
 *   3. rollup MVs match a raw GROUP BY
 *   4. replaying the same batch twice produces no duplicates (with and without the state commit)
 * (5. "R2 holds the raw file" is proven on workerd with a real local R2 bucket: test/e2e.)
 */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const BASE = (process.env.TW_CH_URL ?? 'http://127.0.0.1:8123').replace(/\/+$/, '');
const USER = process.env.TW_CH_USER ?? 'default';
const PASSWORD = process.env.TW_CH_PASSWORD ?? '';
const db = `tw_stage3_${Date.now()}`;
// Newer ClickHouse (Cloud 26.x) prints UInt64 in JSON WITHOUT quotes by default, and JSON.parse then rounds
// a 19-digit visitor_hash (…900 became …800 on the owner's Cloud service). Always ask for quoted 64-bit ints.
// TW_TEST_QUOTE64=0 reproduces the Cloud default (used once to prove the failure).
const QUOTE64 = process.env.TW_TEST_QUOTE64 ?? '1';

async function sql(statement: string): Promise<string> {
  // select_sequential_consistency: read-your-writes on ClickHouse Cloud's replicas (ignored by a plain server).
  const res = await fetch(`${BASE}/?select_sequential_consistency=1&output_format_json_quote_64bit_integers=${QUOTE64}`, {
    method: 'POST',
    headers: { 'X-ClickHouse-User': USER, 'X-ClickHouse-Key': PASSWORD },
    body: statement,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`clickhouse_${res.status}: ${text.slice(0, 300)}`);
  return text.trim();
}
const rows = async (query: string): Promise<Record<string, unknown>[]> =>
  (await sql(`${query} FORMAT JSONEachRow`)).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const one = async (query: string): Promise<number> => Number(await sql(query));

const T = Date.UTC(2026, 8, 30, 12, 5, 0);

/** Wraps the real port so the test also knows exactly what was sent. */
function recording(port: ClickHousePort) {
  const sent: { table: ClickHouseTable; rows: object[] }[] = [];
  return {
    sent,
    port: {
      async insert(table: ClickHouseTable, r: readonly object[], token: string) {
        await port.insert(table, r, token);
        sent.push({ table, rows: [...r] });
      },
    } satisfies ClickHousePort,
  };
}

const real = () => createClickHousePort({ url: BASE, user: USER, password: PASSWORD, database: db });

const run = (messages: InboundMessage[], state: StatePort, clickhouse: ClickHousePort = real()) =>
  processBatch(messages, { clickhouse, state, now: () => T, log: () => undefined }, { requireArchive: false });

async function wireBatch(prefix: string): Promise<InboundMessage[]> {
  return (await wireQueueMessages()).map(({ message }, i) => ({ id: `${prefix}-${i}`, timestamp: T, body: message }));
}

/** Session state = sum of signs (VersionedCollapsingMergeTree), valid before and after merges. */
const sessionTotals = async (site = 123) => ({
  sessions: await one(`SELECT sum(sign) FROM ${db}.sessions WHERE site_id = ${site}`),
  engagedSessions: await one(`SELECT sum(is_engaged * sign) FROM ${db}.sessions WHERE site_id = ${site}`),
  pageviews: await one(`SELECT sum(toInt64(pageviews) * sign) FROM ${db}.sessions WHERE site_id = ${site}`),
});

describe('Stage 3 on a real ClickHouse', () => {
  beforeAll(async () => {
    const ddl = readFileSync(new URL('../../../../infra/clickhouse/001_contract.sql', import.meta.url), 'utf8');
    const statements = ddl
      .replace(/^--.*$/gm, '')
      .replaceAll('tailwatch', db)
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const statement of statements) await sql(statement);
  });

  afterAll(async () => {
    if (process.env.TW_KEEP_TEST_DB === '1') {
      console.log(`TW_KEEP_TEST_DB=1: database ${db} kept. Look at it in the SQL console, then: DROP DATABASE ${db}`);
      return;
    }
    await sql(`DROP DATABASE IF EXISTS ${db}`);
  });

  it('1. the 22 accepted wire fixtures land as exactly the rows the consumer sent', async () => {
    const rec = recording(real());
    const result = await run(await wireBatch('w'), createMemoryState(), rec.port);
    expect(result).toMatchObject({ events: 22, duplicates: 0, poison: 0 });

    const sentEvents = rec.sent.filter((s) => s.table === 'events').flatMap((s) => s.rows) as Record<string, unknown>[];
    const stored = await rows(`SELECT * FROM ${db}.events WHERE site_id = 123 ORDER BY seq, insert_id`);
    expect(stored).toHaveLength(22);

    // ClickHouse's JSON output prints UInt64 as strings; everything else must round-trip unchanged.
    const normalise = (r: Record<string, unknown>) => ({ ...r, site_id: String(r.site_id), session_id: String(r.session_id), visitor_hash: String(r.visitor_hash) });
    const bySeq = (a: Record<string, unknown>, b: Record<string, unknown>) =>
      Number(a.seq) - Number(b.seq) || String(a.insert_id).localeCompare(String(b.insert_id));
    expect(stored.map(normalise).sort(bySeq)).toEqual(sentEvents.map(normalise).sort(bySeq));

    // A few frozen facts, independent of the row builder:
    const byInsert = new Map(stored.map((r) => [r.insert_id, r]));
    expect(byInsert.get('insert-0002')).toMatchObject({ pathname: '/page/1', route: '/page/[id]', referrer: 'https://ref.example/path', screen_width: 1440 });
    expect(byInsert.get('insert-0003')).toMatchObject({ name: 'signup', props: { plan: 'pro', seats: '5', trial: 'false' } });
    expect(stored.every((r) => r.browser === 'Chrome' && r.os === 'Windows')).toBe(true);
    expect(JSON.stringify(stored)).not.toContain(FIXTURE_IP);
  });

  it('2. the session fixture gives the frozen Stage 1 numbers inside ClickHouse', async () => {
    const msgs = sessionQueueMessages().map((body, i) => ({ id: `s-${i}`, timestamp: T, body }));
    // Site 124 so these rows never mix with test 1.
    for (const m of msgs) (m.body.event as { siteId: number }).siteId = 124;
    const result = await run(msgs, createMemoryState());
    expect(result.events).toBe(18);
    expect(await sessionTotals(124)).toEqual({
      sessions: sessionExpected.sessions,
      engagedSessions: sessionExpected.engagedSessions,
      pageviews: sessionExpected.pageviews,
    });
    expect(await one(`SELECT uniqExact(visitor_hash) FROM ${db}.events WHERE site_id = 124`)).toBe(sessionExpected.uniqueVisitors);
    expect(await one(`SELECT countIf(is_session_start = 1) FROM ${db}.events WHERE site_id = 124`)).toBe(sessionExpected.sessions);
  });

  it('3. the 15-minute rollup equals a raw GROUP BY over events', async () => {
    const fromRollup = await rows(
      `SELECT site_id, bucket, pathname, uniqMerge(visitors) AS v, countMerge(pageviews) AS p, sumMerge(engagement_ms) AS e
       FROM ${db}.rollup_15m_pages GROUP BY site_id, bucket, pathname ORDER BY site_id, bucket, pathname`,
    );
    const fromRaw = await rows(
      `SELECT site_id, toStartOfFifteenMinutes(timestamp) AS bucket, pathname, uniq(visitor_hash) AS v, count() AS p, sum(engagement_ms) AS e
       FROM ${db}.events WHERE name = 'pageview' GROUP BY site_id, bucket, pathname ORDER BY site_id, bucket, pathname`,
    );
    expect(fromRollup.length).toBeGreaterThan(10);
    expect(fromRollup).toEqual(fromRaw);
  });

  it('4a. replaying the same batch after a crash BEFORE the state commit adds nothing (ClickHouse token de-dup)', async () => {
    const before = { events: await one(`SELECT count() FROM ${db}.events`), sessions: await sessionTotals(), rollup: await one(`SELECT countMerge(pageviews) FROM ${db}.rollup_15m_pages`) };
    // A fresh state store = the commit of the first run never happened.
    await run(await wireBatch('w'), createMemoryState());
    expect(await one(`SELECT count() FROM ${db}.events`)).toBe(before.events);
    expect(await sessionTotals()).toEqual(before.sessions);
    expect(await one(`SELECT countMerge(pageviews) FROM ${db}.rollup_15m_pages`)).toBe(before.rollup);
  });

  it('4b. replaying after a successful commit, even regrouped with new messages, adds only the new ones', async () => {
    const state = createMemoryState();
    const first = await wireBatch('x');
    await run(first, state);
    const count = await one(`SELECT count() FROM ${db}.events`);

    // Same messages again, shuffled into a batch with one new message: a different batch token, so
    // ClickHouse alone could not catch it. The state store's de-dup markers do.
    const extra: InboundMessage = { ...first[0]!, id: 'x-new', body: structuredClone(first[0]!.body) };
    (extra.body as { event: { insertId?: string; seq: number } }).event.insertId = 'brand-new';
    const result = await run([...first].reverse().concat(extra), state);
    expect(result).toMatchObject({ events: 1, duplicates: 22 });
    expect(await one(`SELECT count() FROM ${db}.events`)).toBe(count + 1);
  });

  it('UInt64 visitor hashes keep every digit (a JS number could not)', async () => {
    const hashes = (await wireQueueMessages()).map((m) => m.message.visitor.hash);
    const stored = (await rows(`SELECT DISTINCT toString(visitor_hash) AS h FROM ${db}.events WHERE site_id = 123`)).map((r) => r.h);
    expect(stored).toContain(hashes[0]);
  });
});
