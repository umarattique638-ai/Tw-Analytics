import type { AnalyticsEraser, DataTable } from './eraser';
import { DATA_TABLES, tablesWithRows, totalOf } from './eraser';
import { deleteKeys } from './kv';
import type { SiteConfigSink } from './kv';
import { erasureDoneMail } from './mail';
import type { Mailer } from './mail';
import type { ControlStore, ErasureDoc, ErasurePatch, SiteDoc } from './store/types';

/**
 * The two nightly jobs of Phase 3 (PLAN 9.2: "retention policy enforcement + pruning job", "account
 * deletion -> export-then-erase"). Both are idempotent: running one twice, or after a crash halfway,
 * does no harm and finishes the work.
 */

/**
 * After an account is deleted, events the collector had already accepted can still arrive for a while
 * (queue retries, the dead-letter replay). The erasure is only called complete when a count finds no
 * rows at least this long after the request.
 */
export const ERASURE_SETTLE_DAYS = 2;
/**
 * And after completion it is still watched this long: late rows (a dead letter replayed late) and KV keys
 * written back by a request that raced the deletion are removed again. Same as the R2 lifecycle of the raw
 * archive and dlq-dead/ (docs/ERASURE.md), the last place an event of the account could come back from.
 */
export const ERASURE_WATCH_DAYS = 30;
/** A delete that has not finished yet is sent again after this long (it runs in the background). */
export const ERASURE_RESEND_HOURS = 6;
/** Right after a deletion request, counting rows (for the receipt) may take this long before the deletes go out anyway. */
const COUNT_FIRST_MS = 6_000;
/**
 * Retention runs in weekly batches: a site's old rows are deleted once some are at least this many days
 * past its retention. A ClickHouse delete rewrites the data parts it touches, so one delete a week (taking
 * 7 days of rows) instead of one a night (taking 1) is 7x less rewriting for the same result.
 */
export const PRUNE_SLACK_DAYS = 6;

const DAY = 86_400_000;

export interface JobDeps {
  store: ControlStore;
  kv: SiteConfigSink;
  /** Null when TW_CH_PRUNE_PASSWORD is not set: nothing can be deleted from ClickHouse. */
  eraser: AnalyticsEraser | null;
  mailer: Mailer;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);

/** Runs `work`, but gives up waiting after `ms` (the work itself may still finish in the background). */
async function within<T>(ms: number | undefined, work: () => Promise<T>): Promise<T> {
  if (!ms) return work();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('slow to answer; the nightly job continues')), ms);
  });
  try {
    return await Promise.race([work(), late]);
  } finally {
    clearTimeout(timer);
  }
}

const union = <T>(a: T[], b: T[]) => [...new Set([...a, ...b])];

/**
 * One step forward for an account erasure:
 *   0. Sites still stored for the workspace (created by a request that raced the deletion) are deleted
 *      and added to the erasure.
 *   1. Cloudflare KV: every key of every site is deleted, at EVERY step (cheap, and a racing request could
 *      have written one back).
 *   2. ClickHouse: the sites' rows are counted; where rows remain, the deletes are sent.
 *   3. A pending erasure is complete when KV is clean and a count after the settle time finds nothing; the
 *      "erasure finished" e-mail goes out and the address is removed. A completed one is watched for
 *      ERASURE_WATCH_DAYS (steps 0-2 again, no e-mail).
 * Options: `finish: false` never completes (right after the request); `dataBudgetMs` stops waiting for
 * ClickHouse after that long (the request must answer within Vercel's 30 s); `deleteFirst` (right after the
 * user asked) sends the deletes for every table at once WITHOUT counting first: counting four tables on a
 * ClickHouse Cloud service that is waking up from idle could use up the whole budget, and then nothing was
 * deleted until the nightly run. The nightly run counts, re-sends where rows remain, and verifies.
 */
export async function advanceErasure(
  deps: JobDeps,
  e: ErasureDoc,
  now: Date,
  options: { finish?: boolean; dataBudgetMs?: number; deleteFirst?: boolean } = {},
): Promise<ErasureDoc> {
  const finish = options.finish ?? true;
  const patch: ErasurePatch = { attempts: e.attempts + 1, updatedAt: now, lastError: null };
  const errors: string[] = [];
  let siteIds = e.siteIds;
  let publicKeys = e.publicKeys;

  try {
    const orphans = await deps.store.sitesOf(e._id, true);
    if (orphans.length) {
      siteIds = union(siteIds, orphans.map((s) => s._id));
      publicKeys = union(publicKeys, orphans.flatMap((s) => s.keys.map((k) => k.publicKey)));
      // Remember them in the erasure BEFORE deleting them, so a crash in between loses nothing.
      await deps.store.updateErasure(e._id, { siteIds, publicKeys });
      await deps.store.deleteSitesOf(e._id);
    }
  } catch (error) {
    errors.push(`MongoDB: ${message(error)}`);
  }

  const kvClean = await deleteKeys(deps.kv, publicKeys);
  if (kvClean) patch.kvDoneAt = e.kvDoneAt ?? now;
  else errors.push('Cloudflare KV: some site keys could not be deleted yet (check CF_API_TOKEN).');

  let dataClean = false;
  if (!siteIds.length) {
    dataClean = true; // a workspace without sites has nothing in ClickHouse
    if (!e.rowsFound) patch.rowsFound = { events: 0, sessions: 0, dropped_hits: 0, rollup_15m_pages: 0 };
  } else if (!deps.eraser) {
    errors.push('ClickHouse delete user is not configured (TW_CH_PRUNE_PASSWORD).');
  } else {
    const eraser = deps.eraser;
    try {
      await within(options.dataBudgetMs, async () => {
        if (options.deleteFirst) {
          // The receipt's row count if ClickHouse answers quickly; the deletes go out either way.
          const counts = await within(COUNT_FIRST_MS, () => eraser.count(siteIds, null)).catch(() => null);
          if (counts && !e.rowsFound) patch.rowsFound = Object.fromEntries(DATA_TABLES.map((t) => [t, totalOf(counts, t)])) as Record<DataTable, number>;
          // One retry: the first call can time out while an idle ClickHouse Cloud service wakes up.
          await eraser.remove(siteIds, null, [...DATA_TABLES]).catch(() => eraser.remove(siteIds, null, [...DATA_TABLES]));
          patch.dataDeleteSentAt = now;
          return;
        }
        const counts = await eraser.count(siteIds, null);
        const left = totalOf(counts);
        if (!e.rowsFound) patch.rowsFound = Object.fromEntries(DATA_TABLES.map((t) => [t, totalOf(counts, t)])) as Record<DataTable, number>;
        if (left === 0) {
          dataClean = true;
          return;
        }
        // Sites found since the last delete (step 0) have never had one: send now, whatever the time.
        const newSites = siteIds.length !== e.siteIds.length;
        const sentLongAgo = newSites || !e.dataDeleteSentAt || now.getTime() - e.dataDeleteSentAt.getTime() >= ERASURE_RESEND_HOURS * 3_600_000;
        if (sentLongAgo) {
          await eraser.remove(siteIds, null, tablesWithRows(counts));
          patch.dataDeleteSentAt = now;
          if (e.status === 'completed') patch.rowsAfterCompletion = e.rowsAfterCompletion + left;
        }
        if (e.status === 'pending') patch.dataVerifiedAt = null;
      });
    } catch (error) {
      errors.push(`ClickHouse: ${message(error)}`);
    }
  }

  const settled = now.getTime() - e.requestedAt.getTime() >= ERASURE_SETTLE_DAYS * DAY;
  if (e.status === 'pending' && dataClean && settled) patch.dataVerifiedAt = e.dataVerifiedAt ?? now;

  if (finish && e.status === 'pending' && kvClean && dataClean && settled) {
    const found = patch.rowsFound ?? e.rowsFound;
    if (e.email && deps.mailer.configured) {
      try {
        await deps.mailer.send(erasureDoneMail(e.email, e.name, found ? DATA_TABLES.reduce((n, t) => n + found[t], 0) : 0, ERASURE_WATCH_DAYS));
      } catch (error) {
        // The erasure is complete either way; the e-mail is a courtesy.
        console.error(JSON.stringify({ tw: 'mail_failed', kind: 'erasure_done', message: message(error) }));
      }
    }
    Object.assign(patch, { status: 'completed', completedAt: now, email: null, name: null } satisfies ErasurePatch);
  }
  if (errors.length) patch.lastError = errors.join(' ').slice(0, 500);
  await deps.store.updateErasure(e._id, patch);
  if (errors.length) console.error(JSON.stringify({ tw: 'erasure_step_failed', erasure: e._id.toHexString(), errors }));
  return { ...e, ...patch };
}

/** First instant that is kept: UTC midnight, `days` days ago. Older rows are removed. */
export function retentionCutoff(now: Date, days: number): Date {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(midnight - days * DAY);
}

export interface PrunedSite {
  site: SiteDoc;
  cutoff: Date;
  rows: Record<DataTable, number>;
}

/**
 * Retention: for every group of sites with the same retention, once some rows are PRUNE_SLACK_DAYS past
 * the cutoff, every row older than the cutoff is counted and deleted (only in tables that have such rows).
 * Returns what was removed per site, for the activity log. Stops starting new groups after `deadline`
 * (the next night continues).
 */
export async function pruneRetention(eraser: AnalyticsEraser, sites: SiteDoc[], now: Date, deadline: number): Promise<PrunedSite[]> {
  const groups = new Map<number, SiteDoc[]>();
  for (const s of sites) {
    // retentionDays has a validator minimum of 1; anything odd is skipped rather than deleting too much.
    if (!Number.isInteger(s.retentionDays) || s.retentionDays < 1) continue;
    groups.set(s.retentionDays, [...(groups.get(s.retentionDays) ?? []), s]);
  }
  const out: PrunedSite[] = [];
  for (const [days, list] of [...groups].sort((a, b) => a[0] - b[0])) {
    if (Date.now() > deadline) break;
    const cutoff = retentionCutoff(now, days);
    const ids = list.map((s) => s._id);
    if (totalOf(await eraser.count(ids, new Date(cutoff.getTime() - PRUNE_SLACK_DAYS * DAY))) === 0) continue;
    const counts = await eraser.count(ids, cutoff);
    const tables = tablesWithRows(counts);
    if (!tables.length) continue;
    await eraser.remove(
      list.filter((s) => DATA_TABLES.some((t) => (counts[t].get(s._id) ?? 0) > 0)).map((s) => s._id),
      cutoff,
      tables,
    );
    for (const site of list) {
      const rows = Object.fromEntries(DATA_TABLES.map((t) => [t, counts[t].get(site._id) ?? 0])) as Record<DataTable, number>;
      if (DATA_TABLES.some((t) => rows[t] > 0)) out.push({ site, cutoff, rows });
    }
  }
  return out;
}
