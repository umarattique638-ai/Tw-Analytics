import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '@tailwatch/contract';
import type { SessionRecord } from '../src/core/rows';
import type { StatePort } from '../src/process';
import { createMemoryState } from '../src/state/memory';
import { SessionStateObject } from '../src/state/object';
import type { DurableObjectStateLike } from '../src/state/object';
import { StateStoreError, createDurableState } from '../src/state/port';
import type { DurableNamespaceLike } from '../src/state/port';

/**
 * The Durable Object state store, run on real SQLite (node:sqlite) through the same fetch protocol the
 * Worker uses. The workerd run with the real Durable Object runtime is apps/consumer/test/e2e.
 */

// Vitest 2 does not resolve the new node:sqlite builtin through its module graph; Node's require does.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = DatabaseSyncType;

const T = Date.UTC(2026, 9, 1, 12, 0, 0);

function record(visitor: string, pageviews: number): SessionRecord {
  return {
    state: { visitor, id: Math.floor(T / 1000), start: T, end: T, pageviews, customEvents: 0, engagementMs: 0, engaged: pageviews >= 2, version: pageviews },
    entryPath: '/', exitPath: '/', referrerSource: '', utmSource: '', country: 'PK', device: 'desktop', browser: 'Chrome', os: 'Windows',
  };
}

/** A Durable Object state over one SQLite database, with an optional failure injected into SQL. */
function objectState(db: DatabaseSync, failOn?: RegExp): DurableObjectStateLike & { alarm: number | null } {
  const s: DurableObjectStateLike & { alarm: number | null } = {
    alarm: null,
    storage: {
      sql: {
        exec(query, ...bindings) {
          if (failOn?.test(query)) throw new Error('disk full');
          const rows = db.prepare(query).all(...bindings) as Record<string, unknown>[];
          return { toArray: () => rows };
        },
      },
      transactionSync(fn) {
        db.exec('BEGIN');
        try {
          const out = fn();
          db.exec('COMMIT');
          return out;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      },
      async getAlarm() {
        return s.alarm;
      },
      async setAlarm(t) {
        s.alarm = t;
      },
    },
  };
  return s;
}

/** A namespace whose objects are SessionStateObjects over per-name SQLite databases. */
function namespace(opts: { failOn?: RegExp } = {}) {
  const dbs = new Map<string, DatabaseSync>();
  const states = new Map<string, ReturnType<typeof objectState>>();
  const touched: string[] = [];
  const ns: DurableNamespaceLike = {
    idFromName: (name) => name,
    get: (id) => ({
      async fetch(url, init) {
        const name = String(id);
        touched.push(name);
        if (!dbs.has(name)) dbs.set(name, new DatabaseSync(':memory:'));
        const state = states.get(name) ?? objectState(dbs.get(name)!, opts.failOn);
        states.set(name, state);
        // A new object instance per call, as after an eviction: all state must come from SQLite.
        const res = await new SessionStateObject(state).fetch(new Request(url, init));
        return res;
      },
    }),
  };
  return { ns, dbs, states, touched };
}

/** The same behaviour is required from the Durable Object port and the in-memory port. */
const ports: [string, () => StatePort][] = [
  ['durable object (SQLite)', () => createDurableState(namespace().ns, { shards: 4 })],
  ['memory', () => createMemoryState()],
];

for (const [label, make] of ports) {
  describe(`StatePort contract: ${label}`, () => {
    it('round-trips sessions per site and reports seen de-dup keys', async () => {
      const state = make();
      await state.commit([{ siteId: 1, visitor: '11', record: record('11', 1) }], [{ siteId: 1, key: 'i:1:a' }], T);
      const snap = await state.load(
        [
          { siteId: 1, visitors: ['11', '12'], dedupeKeys: ['i:1:a', 'i:1:b'] },
          { siteId: 2, visitors: ['11'], dedupeKeys: [] },
        ],
        T + 1,
      );
      expect(snap.sessions.get('1:11')?.state.pageviews).toBe(1);
      expect(snap.sessions.has('2:11')).toBe(false);
      expect([...snap.seen]).toEqual(['i:1:a']);
    });

    it('a later commit replaces the session record', async () => {
      const state = make();
      await state.commit([{ siteId: 1, visitor: '11', record: record('11', 1) }], [], T);
      await state.commit([{ siteId: 1, visitor: '11', record: record('11', 2) }], [], T + 1000);
      const snap = await state.load([{ siteId: 1, visitors: ['11'], dedupeKeys: [] }], T + 2000);
      expect(snap.sessions.get('1:11')?.state.pageviews).toBe(2);
    });

    it('sessions expire 30 min after the last commit, de-dup markers after 7 days', async () => {
      const state = make();
      await state.commit([{ siteId: 1, visitor: '11', record: record('11', 1) }], [{ siteId: 1, key: 'm:x' }], T);
      const load = (now: number) => state.load([{ siteId: 1, visitors: ['11'], dedupeKeys: ['m:x'] }], now);
      expect((await load(T + LIMITS.sessionGapMs - 1)).sessions.size).toBe(1);
      expect((await load(T + LIMITS.sessionGapMs)).sessions.size).toBe(0);
      expect((await load(T + LIMITS.dedupeWindowMs - 1)).seen.size).toBe(1);
      expect((await load(T + LIMITS.dedupeWindowMs)).seen.size).toBe(0);
    });

    it('handles far more keys than one SQL statement may bind', async () => {
      const state = make();
      const visitors = Array.from({ length: 250 }, (_, i) => String(1000 + i));
      await state.commit(
        visitors.map((v) => ({ siteId: 3, visitor: v, record: record(v, 1) })),
        visitors.map((v) => ({ siteId: 3, key: `i:3:${v}` })),
        T,
      );
      const snap = await state.load([{ siteId: 3, visitors, dedupeKeys: visitors.map((v) => `i:3:${v}`) }], T + 1);
      expect(snap.sessions.size).toBe(250);
      expect(snap.seen.size).toBe(250);
    });
  });
}

describe('Durable Object specifics', () => {
  it('shards by siteId % shards: one call per touched shard, whatever the number of sites', async () => {
    const n = namespace();
    const state = createDurableState(n.ns, { shards: 4 });
    const loads = [1, 2, 5, 9, 13].map((siteId) => ({ siteId, visitors: ['1'], dedupeKeys: [] }));
    await state.load(loads, T);
    // sites 1, 5, 9, 13 -> shard 1; site 2 -> shard 2
    expect([...new Set(n.touched)].sort()).toEqual(['sessions-shard-1', 'sessions-shard-2']);
    expect(n.touched).toHaveLength(2);
  });

  it('survives an object restart: everything is read back from SQLite', async () => {
    const n = namespace();
    const state = createDurableState(n.ns, { shards: 1 });
    await state.commit([{ siteId: 1, visitor: '11', record: record('11', 3) }], [{ siteId: 1, key: 'm:1' }], T);
    // namespace() builds a NEW SessionStateObject for every call already; load must still see the data.
    const snap = await state.load([{ siteId: 1, visitors: ['11'], dedupeKeys: ['m:1'] }], T + 1);
    expect(snap.sessions.get('1:11')?.state.pageviews).toBe(3);
    expect(snap.seen.has('m:1')).toBe(true);
  });

  it('a failure inside a commit rolls back the WHOLE commit (sessions and markers together)', async () => {
    const n = namespace({ failOn: /INSERT INTO dedupe/ });
    const state = createDurableState(n.ns, { shards: 1 });
    await expect(
      state.commit([{ siteId: 1, visitor: '11', record: record('11', 1) }], [{ siteId: 1, key: 'm:1' }], T),
    ).rejects.toThrow('disk full'); // propagates like a workerd DO exception -> batch retry
    const db = n.dbs.get('sessions-shard-0')!;
    expect(db.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 0 });
  });

  it('schedules a daily sweep alarm, and the alarm deletes expired rows', async () => {
    const n = namespace();
    const state = createDurableState(n.ns, { shards: 1 });
    await state.commit([{ siteId: 1, visitor: '11', record: record('11', 1) }], [{ siteId: 1, key: 'm:1' }], T - LIMITS.dedupeWindowMs - 10);
    const objState = n.states.get('sessions-shard-0')!;
    expect(objState.alarm).not.toBeNull();
    await new SessionStateObject(objState).alarm();
    const db = n.dbs.get('sessions-shard-0')!;
    expect(db.prepare('SELECT (SELECT count(*) FROM sessions) + (SELECT count(*) FROM dedupe) AS n').get()).toEqual({ n: 0 });
  });

  it('rejects anything but POST /load and /commit', async () => {
    const db = new DatabaseSync(':memory:');
    const obj = new SessionStateObject(objectState(db));
    expect((await obj.fetch(new Request('https://state/load'))).status).toBe(405);
    expect((await obj.fetch(new Request('https://state/nope', { method: 'POST', body: '{}' }))).status).toBe(404);
    expect((await obj.fetch(new Request('https://state/load', { method: 'POST', body: '{{' }))).status).toBe(400);
  });
});

describe('Durable Object port errors', () => {
  it('a non-2xx answer from the object becomes a StateStoreError (batch retry, safe log code)', async () => {
    const ns: DurableNamespaceLike = {
      idFromName: (n) => n,
      get: () => ({ fetch: async () => new Response('nope', { status: 503 }) }),
    };
    await expect(createDurableState(ns).load([{ siteId: 1, visitors: ['1'], dedupeKeys: [] }], T)).rejects.toBeInstanceOf(StateStoreError);
  });
});
