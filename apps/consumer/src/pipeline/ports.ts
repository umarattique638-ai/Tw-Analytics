import type { SessionRecord } from '../core/rows';

/**
 * The outside world of the pipeline. Every external system is a port, so the pipeline has no Cloudflare
 * or ClickHouse types in it and is tested with fakes (the same lock-in rule as the collector).
 */

export type ClickHouseTable = 'events' | 'sessions' | 'dropped_hits';

export interface ClickHousePort {
  /** One INSERT of many rows. Never called with a single row per event. */
  insert(table: ClickHouseTable, rows: readonly object[], dedupToken: string): Promise<void>;
}

/** What one batch needs from the state store for one site. */
export interface StateLoad {
  siteId: number;
  visitors: string[];
  dedupeKeys: string[];
}

export interface StateSnapshot {
  /** Keyed `${siteId}:${visitor}`. */
  sessions: Map<string, SessionRecord>;
  /** De-dup keys already processed within the last 7 days. */
  seen: Set<string>;
  /** De-dup key -> insert group of an earlier, unfinished attempt. */
  intents?: Map<string, string>;
}

export interface StateUpdate {
  siteId: number;
  visitor: string;
  record: SessionRecord;
}

export interface StatePort {
  load(requests: readonly StateLoad[], now: number): Promise<StateSnapshot>;
  /** Records the insert group of each event BEFORE the inserts (an existing intent is kept). */
  intend?(entries: readonly { siteId: number; key: string; group: string }[], now: number): Promise<void>;
  /** Sessions and de-dup markers are committed together (one transaction per shard). */
  commit(updates: readonly StateUpdate[], dedupe: readonly { siteId: number; key: string }[], now: number): Promise<void>;
}

export interface ArchivePort {
  /** R2 PUT of one NDJSON object. */
  put(key: string, body: string): Promise<void>;
}

export interface Ports {
  clickhouse: ClickHousePort;
  state: StatePort;
  archive?: ArchivePort;
  now(): number;
  log(event: string, fields?: Record<string, string | number>): void;
}

export interface Options {
  requireArchive: boolean;
}

/** A queue message as the pipeline sees it. */
export interface InboundMessage {
  id: string;
  timestamp: number;
  body: unknown;
}

export interface BatchResult {
  events: number;
  duplicates: number;
  dropsRecorded: number;
  poison: number;
  ignored: number;
  sessionsStarted: number;
  /** Events the precision pass dropped (Stage 7), also included in dropsRecorded. */
  precisionDrops: number;
  archiveKey: string | null;
}

export const emptyResult = (): BatchResult => ({ events: 0, duplicates: 0, dropsRecorded: 0, poison: 0, ignored: 0, sessionsStarted: 0, precisionDrops: 0, archiveKey: null });
