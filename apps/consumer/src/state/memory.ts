import { LIMITS } from '@tailwatch/contract';
import type { SessionRecord } from '../core/rows';
import type { StateLoad, StatePort, StateSnapshot, StateUpdate } from '../process';
import { sessionKey } from './port';

/**
 * In-memory StatePort for tests and for `wrangler dev` without a Durable Object binding. NEVER production:
 * a Worker isolate's memory is per isolate and is recycled at any time.
 *
 * Same semantics as the Durable Object store: TTLs measured from the commit, copies in and out,
 * and sessions + de-dup markers committed together.
 */
export type MemoryState = StatePort & { size(): { sessions: number; dedupe: number } };

export function createMemoryState(): MemoryState {
  const sessions = new Map<string, { record: SessionRecord; expiresAt: number }>();
  const dedupe = new Map<string, number>();

  return {
    async load(requests: readonly StateLoad[], now: number): Promise<StateSnapshot> {
      const snapshot: StateSnapshot = { sessions: new Map(), seen: new Set() };
      for (const r of requests) {
        for (const visitor of r.visitors) {
          const key = sessionKey(r.siteId, visitor);
          const hit = sessions.get(key);
          if (hit && hit.expiresAt > now) snapshot.sessions.set(key, structuredClone(hit.record));
        }
        for (const key of r.dedupeKeys) {
          const expiresAt = dedupe.get(key);
          if (expiresAt !== undefined && expiresAt > now) snapshot.seen.add(key);
        }
      }
      return snapshot;
    },

    async commit(updates: readonly StateUpdate[], marks: readonly { siteId: number; key: string }[], now: number): Promise<void> {
      for (const u of updates) {
        sessions.set(sessionKey(u.siteId, u.visitor), { record: structuredClone(u.record), expiresAt: now + LIMITS.sessionGapMs });
      }
      for (const m of marks) dedupe.set(m.key, now + LIMITS.dedupeWindowMs);
      for (const [k, v] of sessions) if (v.expiresAt <= now) sessions.delete(k);
      for (const [k, v] of dedupe) if (v <= now) dedupe.delete(k);
    },

    size: () => ({ sessions: sessions.size, dedupe: dedupe.size }),
  };
}
