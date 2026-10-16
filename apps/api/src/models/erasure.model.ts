import type { ObjectId } from 'mongodb';

/**
 * An account deletion in progress (export-then-erase, PLAN 10.6). The account itself (user, workspace,
 * sites, reports, activity log) is removed from MongoDB at once; this record drives what is left:
 * Cloudflare KV keys, then the ClickHouse rows of the sites, until a count proves there is nothing left.
 * When done it is kept as the receipt, without the e-mail address.
 */
export interface ErasureDoc {
  /** The deleted workspace's id. */
  _id: ObjectId;
  siteIds: number[];
  publicKeys: string[];
  /** For the "erasure finished" e-mail only; removed when the erasure completes. */
  email: string | null;
  name: string | null;
  requestedAt: Date;
  status: 'pending' | 'completed';
  kvDoneAt: Date | null;
  /** Last time the ClickHouse delete was sent (it runs in the background on the server). */
  dataDeleteSentAt: Date | null;
  /** First check that found no rows left, after the settle time (late queue retries could still land). */
  dataVerifiedAt: Date | null;
  /** Rows found per table at the first check, for the receipt. */
  rowsFound: { events: number; sessions: number; dropped_hits: number; rollup_15m_pages: number } | null;
  /** Rows that came back after completion (late queue retries / replays) and were deleted by the watch. */
  rowsAfterCompletion: number;
  attempts: number;
  lastError: string | null;
  completedAt: Date | null;
  updatedAt: Date;
}

export type ErasurePatch = Partial<Omit<ErasureDoc, '_id'>>;
