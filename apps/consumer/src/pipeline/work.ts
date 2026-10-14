import type { EventRow, SessionRecord, SessionRow } from '../core/rows';
import type { DropItem } from './drops';
import type { InsertGroups } from './groups';
import type { BatchResult, StateSnapshot, StateUpdate } from './ports';

/** The rows one insert group sends to ClickHouse. */
export interface GroupRows {
  events: EventRow[];
  sessions: SessionRow[];
  drops: DropItem[];
}

/**
 * Everything one batch builds up in memory before writing: the rows per insert group, the session records
 * that change, the de-dup keys processed and the intents to record. Nothing here talks to the outside world.
 */
export class BatchWork {
  /** Session records by `${siteId}:${visitor}`, as loaded and as changed by this batch. */
  private readonly cache: Map<string, SessionRecord | null>;
  /** Sessions to commit (step g). */
  readonly dirty = new Map<string, StateUpdate>();
  /** De-dup keys to commit (step g). */
  readonly processedKeys: { siteId: number; key: string }[] = [];
  /** Intents to record before the inserts. */
  readonly intents: { siteId: number; key: string; group: string }[] = [];
  /** Rows per insert group. */
  readonly rows = new Map<string, GroupRows>();
  /** Sessions of late events (older than the current session): kept for this batch only, never stored. */
  readonly detached = new Map<string, SessionRecord>();
  private readonly keysThisBatch = new Set<string>();
  private dropHits = 0;

  constructor(
    private readonly snapshot: StateSnapshot,
    readonly groups: InsertGroups,
    readonly result: BatchResult,
  ) {
    this.cache = new Map<string, SessionRecord | null>(snapshot.sessions);
  }

  /** De-dup: already processed in the last 7 days, or earlier in this very batch (STAGE-1 D5). Counted. */
  isDuplicate(key: string): boolean {
    if (this.snapshot.seen.has(key) || this.keysThisBatch.has(key)) {
      this.result.duplicates += 1;
      return true;
    }
    this.keysThisBatch.add(key);
    return false;
  }

  /** The rows of one insert group. */
  group(name: string): GroupRows {
    let hit = this.rows.get(name);
    if (!hit) this.rows.set(name, (hit = { events: [], sessions: [], drops: [] }));
    return hit;
  }

  /** The key was handled (counted, dropped or found unreadable): mark it seen and remember its group. */
  done(siteId: number, key: string, group: string): void {
    if (!this.snapshot.intents?.has(key)) this.intents.push({ siteId, key, group });
    this.processedKeys.push({ siteId, key });
  }

  addDrop(group: string, item: DropItem): void {
    this.group(group).drops.push(item);
    this.dropHits += item.hits ?? 1;
  }

  /** Dropped hits recorded so far (a batched drop counts as its hits). */
  get dropsRecorded(): number {
    return this.dropHits;
  }

  session(siteId: number, visitor: string): SessionRecord | null {
    return this.cache.get(`${siteId}:${visitor}`) ?? null;
  }

  setSession(siteId: number, visitor: string, record: SessionRecord): void {
    this.cache.set(`${siteId}:${visitor}`, record);
    this.dirty.set(`${siteId}:${visitor}`, { siteId, visitor, record });
  }
}
