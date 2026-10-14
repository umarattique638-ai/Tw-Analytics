import { ClickHouseError } from '../adapters/clickhouse';
import { StateStoreError } from '../state/port';

/** 15 s, 30 s, 60 s ... capped at 15 minutes. `attempts` starts at 1 on the first delivery. */
export function retryDelaySeconds(attempts: number): number {
  const n = Number.isFinite(attempts) && attempts >= 1 ? Math.floor(attempts) : 1;
  return Math.min(15 * 2 ** Math.min(n - 1, 10), 900);
}

const SAFE_MESSAGES: ReadonlySet<string> = new Set(['consumer_not_configured', 'state_not_configured', 'archive_required_but_missing']);

/** What may be logged about a failure: our own codes only, never anything that could carry request data. */
export function safeReason(error: unknown): string {
  if (error instanceof StateStoreError) return error.message;
  if (error instanceof ClickHouseError) {
    return error.code === null ? error.message : `${error.message}:code_${error.code}`;
  }
  if (error instanceof Error && SAFE_MESSAGES.has(error.message)) return error.message;
  return error instanceof Error ? error.name : 'unknown';
}
