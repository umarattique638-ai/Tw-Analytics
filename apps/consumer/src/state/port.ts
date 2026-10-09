import { LIMITS } from '@tailwatch/contract';
import type { SessionRecord } from '../core/rows';
import type { StateLoad, StatePort, StateSnapshot, StateUpdate } from '../process';
import type { CommitRequest, IntendRequest, LoadRequest, LoadResponse } from './store';

/**
 * StatePort backed by the SessionStateObject Durable Object (production, Free plan).
 *
 * Sharding: site `n` lives in shard `n % shards` (default 8). One batch therefore costs at most
 * 2 × shards Durable Object calls, whatever the number of sites in it, which keeps a consumer
 * invocation inside the Free plan's 50 subrequests (STAGE-1 D9). Changing `shards` later moves sites to
 * other objects: open sessions (≤ 30 min) restart and the 7-day de-dup memory starts empty for them.
 */

interface StubLike {
  fetch(
    input: string,
    init: { method: 'POST'; headers: Record<string, string>; body: string },
  ): Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;
}

export interface DurableNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): StubLike;
}

export class StateStoreError extends Error {
  constructor(readonly status: number) {
    super(`state_store_http_${status}`);
    this.name = 'StateStoreError';
  }
}

/**
 * An insert group is remembered as long as an event's de-dup marker (7 days): queue retries end within an
 * hour, but a dead letter can be replayed days later and must still find its first group.
 */
export const INTENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const sessionKey = (siteId: number, visitor: string): string => `${siteId}:${visitor}`;

export function createDurableState(namespace: DurableNamespaceLike, options: { shards?: number } = {}): StatePort {
  const shards = Math.max(1, Math.floor(options.shards ?? 8));
  const stubFor = (shard: number) => namespace.get(namespace.idFromName(`sessions-shard-${shard}`));
  const shardOf = (siteId: number) => siteId % shards;

  async function call<T>(shard: number, path: '/load' | '/commit' | '/intend', body: LoadRequest | CommitRequest | IntendRequest): Promise<T | null> {
    const res = await stubFor(shard).fetch(`https://state${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      await res.text().catch(() => '');
      throw new StateStoreError(res.status);
    }
    return path === '/load' ? ((await res.json()) as T) : null;
  }

  return {
    async load(requests: readonly StateLoad[], now: number): Promise<StateSnapshot> {
      const byShard = new Map<number, LoadRequest>();
      for (const r of requests) {
        const shard = shardOf(r.siteId);
        const entry = byShard.get(shard) ?? { sessionKeys: [], dedupeKeys: [], now };
        entry.sessionKeys.push(...r.visitors.map((v) => sessionKey(r.siteId, v)));
        entry.dedupeKeys.push(...r.dedupeKeys);
        byShard.set(shard, entry);
      }
      const responses = await Promise.all(
        [...byShard].map(([shard, body]) => call<LoadResponse>(shard, '/load', body)),
      );
      const snapshot: StateSnapshot = { sessions: new Map<string, SessionRecord>(), seen: new Set<string>(), intents: new Map<string, string>() };
      for (const response of responses) {
        if (!response) continue;
        for (const [key, record] of Object.entries(response.sessions)) snapshot.sessions.set(key, record);
        for (const key of response.seen) snapshot.seen.add(key);
        for (const [key, group] of Object.entries(response.intents ?? {})) snapshot.intents!.set(key, group);
      }
      return snapshot;
    },

    async intend(entries: readonly { siteId: number; key: string; group: string }[], now: number): Promise<void> {
      const byShard = new Map<number, IntendRequest>();
      for (const e of entries) {
        const shard = shardOf(e.siteId);
        const entry = byShard.get(shard) ?? { entries: [], now, ttlMs: INTENT_TTL_MS };
        entry.entries.push({ key: e.key, group: e.group });
        byShard.set(shard, entry);
      }
      await Promise.all([...byShard].map(([shard, body]) => call(shard, '/intend', body)));
    },

    async commit(updates: readonly StateUpdate[], dedupe: readonly { siteId: number; key: string }[], now: number): Promise<void> {
      const byShard = new Map<number, CommitRequest>();
      const entryFor = (siteId: number): CommitRequest => {
        const shard = shardOf(siteId);
        const entry = byShard.get(shard) ?? {
          sessions: [],
          dedupeKeys: [],
          now,
          sessionTtlMs: LIMITS.sessionGapMs,
          dedupeTtlMs: LIMITS.dedupeWindowMs,
        };
        byShard.set(shard, entry);
        return entry;
      };
      for (const u of updates) entryFor(u.siteId).sessions.push({ key: sessionKey(u.siteId, u.visitor), record: u.record });
      for (const d of dedupe) entryFor(d.siteId).dedupeKeys.push(d.key);
      await Promise.all([...byShard].map(([shard, body]) => call(shard, '/commit', body)));
    },
  };
}
