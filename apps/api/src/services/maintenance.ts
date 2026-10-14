import { errorText, logError, logInfo } from '../http/errors';
import { ERASURE_WATCH_DAYS, advanceErasure, pruneRetention } from '../jobs';
import { expectedEntries, kvProblem } from '../kv';
import { count, dayFmt } from '../views';
import type { Services } from './types';

/** Vercel stops a function at 30 s; each job keeps well inside that. */
const MAINTENANCE_BUDGET_MS = 25_000;
const RECONCILE_BUDGET_MS = 20_000;

/** Account erasures: one step forward each (KV, ClickHouse deletes, verify, finish). */
async function advanceErasures(s: Services, deadline: number) {
  const result = { advanced: 0, completed: 0, failed: 0 };
  const jobDeps = { store: s.store, kv: s.kv, eraser: s.eraser, mailer: s.mailer };
  for (const e of await s.store.activeErasures(new Date(s.now().getTime() - ERASURE_WATCH_DAYS * 86_400_000), 50)) {
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
 * The nightly maintenance run (Vercel Cron, CRON_SECRET): account erasures first, then retention.
 * Retention is off (and reported) when TW_CH_PRUNE_PASSWORD is not set.
 */
export async function runMaintenance(s: Services) {
  const deadline = Date.now() + MAINTENANCE_BUDGET_MS;
  const erasures = await advanceErasures(s, deadline);
  const retention = await pruneOldData(s, deadline);
  logInfo('maintenance', { erasures, retention });
  return { erasures, retention };
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
