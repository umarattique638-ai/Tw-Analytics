import { errorText, logError, logInfo } from '../http/errors';
import { ERASURE_WATCH_DAYS, advanceErasure, pruneRetention } from './jobs.service';
import { DATA_TABLES } from '../repositories/eraser';
import { deleteKeys, expectedEntries, kvProblem } from '../repositories/kv';
import { count, dayFmt } from '../lib/text';
import type { Services } from './types';

/** Vercel stops a function at 30 s; each job keeps well inside that. */
const MAINTENANCE_BUDGET_MS = 25_000;
const RECONCILE_BUDGET_MS = 20_000;

/** Erasures (accounts, sites): one step forward each (KV, ClickHouse deletes, verify, finish); old records removed. */
async function advanceErasures(s: Services, deadline: number) {
  const result = { advanced: 0, completed: 0, failed: 0, removed: 0 };
  const jobDeps = { store: s.store, kv: s.kv, eraser: s.eraser, mailer: s.mailer };
  const watchSince = new Date(s.now().getTime() - ERASURE_WATCH_DAYS * 86_400_000);
  // Watched long enough: the record itself goes (it holds no personal data, but nothing needs it any more).
  try {
    result.removed = await s.store.deleteErasuresCompletedBefore(watchSince);
  } catch (error) {
    logError('erasure_cleanup_failed', { message: errorText(error) });
  }
  for (const e of await s.store.activeErasures(watchSince, 50)) {
    if (Date.now() > deadline) break;
    try {
      const next = await advanceErasure(jobDeps, e, s.now());
      result.advanced += 1;
      if (next.status === 'completed' && e.status === 'pending') result.completed += 1;
      if (next.lastError) result.failed += 1;
    } catch (error) {
      result.failed += 1;
      logError('erasure_failed', { erasure: e._id.toHexString(), message: errorText(error) });
    }
  }
  return result;
}

/** Retention: per site, rows older than its retention are deleted, and the workspace's activity log says so. */
async function pruneOldData(s: Services, deadline: number) {
  const result: { configured: boolean; sitesPruned: number; rows: number; error?: string } = { configured: !!s.eraser, sitesPruned: 0, rows: 0 };
  if (!s.eraser || Date.now() >= deadline) return result;
  try {
    for (const p of await pruneRetention(s.eraser, await s.store.allSites(), s.now(), deadline)) {
      result.sitesPruned += 1;
      const r = p.rows;
      result.rows += r.events + r.sessions + r.dropped_hits + r.rollup_15m_pages;
      const parts = [
        r.events && count(r.events, 'event'),
        r.sessions && count(r.sessions, 'session row'),
        r.dropped_hits && count(r.dropped_hits, 'blocked-hit row'),
        r.rollup_15m_pages && count(r.rollup_15m_pages, 'page-total row'),
      ].filter(Boolean);
      await s.audit.write(
        p.site.tenantId,
        null,
        'data.pruned',
        p.site._id,
        `Removed data of ${p.site.domain} older than ${p.site.retentionDays} days (before ${dayFmt.format(p.cutoff)}): ${parts.join(', ')}`,
      );
    }
  } catch (error) {
    result.error = errorText(error).slice(0, 200);
    logError('retention_failed', { message: result.error });
  }
  return result;
}

/**
 * Sites saved before decision 25 that were never verified (a typo, an abandoned setup): removed for good,
 * with their keys and any rows they collected. Since decision 25 an unverified site is never stored.
 */
async function removeUnverified(s: Services, deadline: number) {
  const result = { removed: 0, failed: 0 };
  for (const site of await s.store.allSites()) {
    if (Date.now() > deadline) break;
    if (site.verifiedAt) continue;
    try {
      await deleteKeys(s.kv, site.keys.map((k) => k.publicKey));
      if (s.eraser) await s.eraser.remove([site._id], null, [...DATA_TABLES]);
      if (await s.store.removeSite(site._id)) result.removed += 1;
    } catch (error) {
      result.failed += 1;
      logError('unverified_remove_failed', { site: site._id, message: errorText(error) });
    }
  }
  return result;
}

/**
 * The nightly maintenance run (Vercel Cron, CRON_SECRET): account erasures first, then retention.
 * Retention is off (and reported) when TW_CH_PRUNE_PASSWORD is not set.
 */
export async function runMaintenance(s: Services) {
  const deadline = Date.now() + MAINTENANCE_BUDGET_MS;
  const erasures = await advanceErasures(s, deadline);
  const unverified = await removeUnverified(s, deadline);
  const retention = await pruneOldData(s, deadline);
  logInfo('maintenance', { erasures, unverified, retention });
  return { erasures, unverified, retention };
}

/**
 * Makes Cloudflare KV match MongoDB for every site: first the known issues, then a full compare (read each
 * entry, write only what differs), in a random order, so that over a few days every site is checked even if
 * one run cannot finish.
 */
export async function reconcileKv(s: Services) {
  const deadline = Date.now() + RECONCILE_BUDGET_MS;
  const fixedIssues = await s.kvSync.reconcileIssues(null, 50);
  let checked = 0;
  let repaired = 0;
  const failed: number[] = [];
  const kvGet = s.kv.get?.bind(s.kv);
  if (kvGet) {
    const all = await s.store.allSites();
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [all[i], all[j]] = [all[j]!, all[i]!];
    }
    for (const loaded of all) {
      if (Date.now() > deadline) break;
      try {
        let wrong = false;
        for (const [name, want] of expectedEntries(loaded)) {
          checked += 1;
          if ((await kvGet(name)) !== want) wrong = true;
        }
        if (!wrong) continue;
        // Re-read: a change made while we were comparing must win over our snapshot.
        const fresh = await s.store.siteById(loaded._id);
        if (!fresh) continue;
        if ((await s.kvSync.sync(fresh)).ok) repaired += 1;
        else failed.push(fresh._id);
      } catch (error) {
        failed.push(loaded._id);
        await s.store.recordKvIssue(loaded._id, loaded.tenantId, kvProblem(error), s.now());
      }
    }
  }
  logInfo('kv_reconcile', { fixedIssues, checked, repaired, failed: failed.length });
  return { fixedIssues, checked, repaired, failed };
}
