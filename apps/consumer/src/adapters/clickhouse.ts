import type { ClickHousePort } from '../process';

/**
 * ClickHouse over the HTTP interface (PLAN 3.1 d/e). Plain fetch, so it runs in a Worker and in Node.
 *
 * - One INSERT per call, body = NDJSON (FORMAT JSONEachRow). Never one request per row.
 * - Idempotency: insert_deduplication_token goes in the SETTINGS clause. ClickHouse docs: the token takes
 *   priority over the data hash, and a retry must use the same settings as the first attempt, so every
 *   retry here re-sends the identical query and body.
 * - Sync inserts by default (ClickHouse deduplicates sync inserts by default; async needs more settings).
 * - deduplicate_blocks_in_dependent_materialized_views=1 on every insert: without it a replayed batch is
 *   dropped by the events table but still re-counted by the rollup MV (proven by test/live, Amendment A1).
 * - Credentials travel in headers, never in the URL.
 * - Errors carry only the HTTP status and the ClickHouse error NUMBER. The response body can quote a
 *   fragment of the rejected row (URLs, referrers), so it is never put in a message or a log (invariant 12).
 */

const TABLES: ReadonlySet<string> = new Set(['events', 'sessions', 'dropped_hits']);
const TOKEN_RE = /^[A-Za-z0-9_-]{1,128}$/; // goes inside a SQL string literal: keep it boring
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

interface FetchResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type FetchLike = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<FetchResponseLike>;

export interface ClickHouseConfig {
  /** Base URL without a path, e.g. https://<service>.clickhouse.cloud:8443 */
  url: string;
  /** Use a dedicated INSERT-only user, never `default` (PROJECT-NOTES 16). */
  user: string;
  password: string;
  database?: string;
  /** Total attempts for transient failures. Default 3. */
  maxAttempts?: number;
  /** First retry delay; doubles each time. Default 250 ms. */
  retryDelayMs?: number;
  /** Per-request timeout. Default 10 000 ms. */
  timeoutMs?: number;
  /** Opt-in async inserts (async_insert, wait_for_async_insert, async_insert_deduplicate). Default off. */
  asyncInsert?: boolean;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
}

export class ClickHouseError extends Error {
  readonly status: number | null;
  readonly code: number | null;
  readonly retryable: boolean;

  constructor(message: string, status: number | null, code: number | null, retryable: boolean) {
    super(message);
    this.name = 'ClickHouseError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

const isRetryableStatus = (status: number): boolean =>
  status === 408 || status === 425 || status === 429 || status >= 500;

/** ClickHouse puts "Code: NNN." at the start of the error text. Only the number is kept. */
function errorCode(header: string | null, body: string): number | null {
  const fromHeader = header === null ? Number.NaN : Number(header);
  if (Number.isInteger(fromHeader)) return fromHeader;
  const match = /^Code:\s*(\d+)/.exec(body);
  return match ? Number(match[1]) : null;
}

const defaultFetch: FetchLike = (url, init) => fetch(url, init);
const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function createClickHousePort(config: ClickHouseConfig): ClickHousePort {
  const database = config.database ?? 'tailwatch';
  if (!IDENT_RE.test(database)) throw new Error('clickhouse_bad_database');

  const base = config.url.replace(/\/+$/, '');
  const maxAttempts = Math.max(1, config.maxAttempts ?? 3);
  const retryDelayMs = config.retryDelayMs ?? 250;
  const timeoutMs = config.timeoutMs ?? 10_000;
  const doFetch = config.fetchImpl ?? defaultFetch;
  const sleep = config.sleep ?? defaultSleep;

  const headers: Record<string, string> = {
    'X-ClickHouse-User': config.user,
    'X-ClickHouse-Key': config.password,
    'Content-Type': 'text/plain; charset=utf-8',
  };

  async function attempt(url: string, body: string): Promise<void> {
    let res: FetchResponseLike;
    try {
      res = await doFetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      // Network failure or timeout. The error text is dropped on purpose.
      throw new ClickHouseError('clickhouse_network', null, null, true);
    }
    if (res.ok) {
      await res.text().catch(() => '');
      return;
    }
    const text = await res.text().catch(() => '');
    const code = errorCode(res.headers.get('x-clickhouse-exception-code'), text);
    throw new ClickHouseError(`clickhouse_http_${res.status}`, res.status, code, isRetryableStatus(res.status));
  }

  return {
    async insert(table, rows, dedupToken): Promise<void> {
      if (rows.length === 0) return;
      if (!TABLES.has(table)) throw new ClickHouseError('clickhouse_unknown_table', null, null, false);
      if (!TOKEN_RE.test(dedupToken)) throw new ClickHouseError('clickhouse_bad_token', null, null, false);

      // The second setting stops a de-duplicated events block from being re-counted by the rollup
      // materialized view (infra/clickhouse/001_contract.sql, Amendment A1).
      const settings = [`insert_deduplication_token='${dedupToken}'`, 'deduplicate_blocks_in_dependent_materialized_views=1'];
      if (config.asyncInsert) {
        settings.push('async_insert=1', 'wait_for_async_insert=1', 'async_insert_deduplicate=1');
      }
      const query = `INSERT INTO ${database}.${table} SETTINGS ${settings.join(', ')} FORMAT JSONEachRow`;
      const url = `${base}/?${new URLSearchParams({ query }).toString()}`;
      const body = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;

      for (let n = 1; ; n += 1) {
        try {
          await attempt(url, body);
          return;
        } catch (error) {
          const failure = error instanceof ClickHouseError ? error : new ClickHouseError('clickhouse_unknown', null, null, false);
          if (!failure.retryable || n >= maxAttempts) throw failure;
          await sleep(retryDelayMs * 2 ** (n - 1));
        }
      }
    },
  };
}