import type { SessionRecord } from '../core/rows';

/**
 * Session + de-duplication state, stored in SQLite (STAGE-1 D4).
 *
 * In production this runs inside a Cloudflare Durable Object with the SQLite storage backend (available
 * on the Workers Free plan). The class only needs `exec` and a synchronous transaction, so the same code
 * runs in Node tests on node:sqlite. No Cloudflare types here (lock-in rule, PLAN 2.4).
 *
 * Why one transaction matters: the session state AND the de-dup markers of the events that produced it
 * are committed together. A crash can never leave "event counted in the session but not marked seen" or
 * the reverse, which would double-count or lose a pageview on the retry.
 *
 * Keys:
 *   sessions.key = `${siteId}:${visitorHash}`    (TTL: 30 min after the last commit, PLAN 3.1 c)
 *   dedupe.key   = dedupeKey(...) from the contract (TTL: 7 days, STAGE-1 D5)
 */

export interface SqlCursorLike {
  toArray(): Record<string, unknown>[];
}

export interface SqlLike {
  exec(query: string, ...bindings: (string | number | null)[]): SqlCursorLike;
}

export interface StoreBackend {
  sql: SqlLike;
  /** Runs fn atomically (Durable Objects: ctx.storage.transactionSync). */
  transaction<T>(fn: () => T): T;
}

export interface LoadRequest {
  sessionKeys: string[];
  dedupeKeys: string[];
  now: number;
}

export interface LoadResponse {
  sessions: Record<string, SessionRecord>;
  seen: string[];
}

export interface CommitRequest {
  sessions: { key: string; record: SessionRecord }[];
  dedupeKeys: string[];
  now: number;
  sessionTtlMs: number;
  dedupeTtlMs: number;
}

/** Durable Object SQLite allows at most 100 bound parameters per statement. */
const MAX_PARAMS = 90;
/** Expired rows removed per commit, so one commit never does unbounded work. */
const SWEEP_PER_COMMIT = 200;

const chunks = <T>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

export class StateStore {
  constructor(private readonly backend: StoreBackend) {
    const { sql } = backend;
    sql.exec('CREATE TABLE IF NOT EXISTS sessions (key TEXT PRIMARY KEY, record TEXT NOT NULL, expires_at INTEGER NOT NULL)');
    sql.exec('CREATE INDEX IF NOT EXISTS sessions_expires ON sessions (expires_at)');
    sql.exec('CREATE TABLE IF NOT EXISTS dedupe (key TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)');
    sql.exec('CREATE INDEX IF NOT EXISTS dedupe_expires ON dedupe (expires_at)');
  }

  load(request: LoadRequest): LoadResponse {
    const { sql } = this.backend;
    const sessions: Record<string, SessionRecord> = {};
    const seen: string[] = [];

    for (const part of chunks([...new Set(request.sessionKeys)], MAX_PARAMS)) {
      const marks = part.map(() => '?').join(',');
      const rows = sql
        .exec(`SELECT key, record FROM sessions WHERE expires_at > ? AND key IN (${marks})`, request.now, ...part)
        .toArray();
      for (const row of rows) sessions[String(row.key)] = JSON.parse(String(row.record)) as SessionRecord;
    }

    for (const part of chunks([...new Set(request.dedupeKeys)], MAX_PARAMS)) {
      const marks = part.map(() => '?').join(',');
      const rows = sql.exec(`SELECT key FROM dedupe WHERE expires_at > ? AND key IN (${marks})`, request.now, ...part).toArray();
      for (const row of rows) seen.push(String(row.key));
    }

    return { sessions, seen };
  }

  commit(request: CommitRequest): void {
    const { sql } = this.backend;
    this.backend.transaction(() => {
      const sessionExpiry = request.now + request.sessionTtlMs;
      for (const { key, record } of request.sessions) {
        sql.exec(
          'INSERT INTO sessions (key, record, expires_at) VALUES (?, ?, ?) ' +
            'ON CONFLICT (key) DO UPDATE SET record = excluded.record, expires_at = excluded.expires_at',
          key,
          JSON.stringify(record),
          sessionExpiry,
        );
      }
      const dedupeExpiry = request.now + request.dedupeTtlMs;
      for (const key of new Set(request.dedupeKeys)) {
        sql.exec(
          'INSERT INTO dedupe (key, expires_at) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET expires_at = excluded.expires_at',
          key,
          dedupeExpiry,
        );
      }
      this.sweepSome(request.now, SWEEP_PER_COMMIT);
    });
  }

  /** Deletes up to `limit` expired rows per table. Returns how many were deleted. */
  sweepSome(now: number, limit: number): number {
    const { sql } = this.backend;
    let deleted = 0;
    for (const table of ['sessions', 'dedupe'] as const) {
      const rows = sql.exec(`SELECT key FROM ${table} WHERE expires_at <= ? LIMIT ?`, now, limit).toArray();
      for (const part of chunks(rows.map((r) => String(r.key)), MAX_PARAMS)) {
        sql.exec(`DELETE FROM ${table} WHERE key IN (${part.map(() => '?').join(',')})`, ...part);
        deleted += part.length;
      }
    }
    return deleted;
  }

  /** Remaining row counts (tests and the alarm's reschedule decision). */
  counts(): { sessions: number; dedupe: number } {
    const { sql } = this.backend;
    const n = (table: string) => Number(sql.exec(`SELECT count(*) AS n FROM ${table}`).toArray()[0]?.n ?? 0);
    return { sessions: n('sessions'), dedupe: n('dedupe') };
  }
}
