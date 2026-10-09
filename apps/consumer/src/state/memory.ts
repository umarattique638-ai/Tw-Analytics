import { LIMITS } from '@tailwatch/contract';
import type { SessionRecord } from '../core/rows';
import type { StateLoad, StatePort, StateSnapshot, StateUpdate } from '../process';
import { INTENT_TTL_MS, sessionKey } from './port';

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
  const intents = new Map<string, { group: string; expiresAt: number }>();

  return {
    async load(requests: readonly StateLoad[], now: number): Promise<StateSnapshot> {
      const snapshot: StateSnapshot = { sessions: new Map(), seen: new Set(), intents: new Map() };
      for (const r of requests) {
        for (const visitor of r.visitors) {
          const key = sessionKey(r.siteId, visitor);
          const hit = sessions.get(key);
          if (hit && hit.expiresAt > now) snapshot.sessions.set(key, structuredClone(hit.record));
        }
        for (const key of r.dedupeKeys) {
          const expiresAt = dedupe.get(key);
          if (expiresAt !== undefined && expiresAt > now) snapshot.seen.add(key);
          const intent = intents.get(key);
          if (intent && intent.expiresAt > now) snapshot.intents!.set(key, intent.group);
        }
      }
      return snapshot;
    },

    async commit(updates: readonly StateUpdate[], marks: readonly { siteId: number; key: string }[], now: number): Promise<void> {
      for (const u of updates) {
        sessions.set(sessionKey(u.siteId, u.visitor), { record: structuredClone(u.record), expiresAt: now + LIMITS.sessionGapMs });
      }
      for (const m of marks) {
        dedupe.set(m.key, now + LIMITS.dedupeWindowMs);
        intents.delete(m.key);
      }
      for (const [k, v] of sessions) if (v.expiresAt <= now) sessions.delete(k);
      for (const [k, v] of dedupe) if (v <= now) dedupe.delete(k);
    },

    async intend(entries: readonly { siteId: number; key: string; group: string }[], now: number): Promise<void> {
      for (const e of entries) if (!intents.has(e.key)) intents.set(e.key, { group: e.group, expiresAt: now + INTENT_TTL_MS });
    },

    size: () => ({ sessions: sessions.size, dedupe: dedupe.size }),
  };
}
