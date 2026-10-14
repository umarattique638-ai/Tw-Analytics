import type { ObjectId } from 'mongodb';
import { HttpError, logError } from '../http/errors';
import { deleteKeys, kvProblem, putKeys, syncSite } from '../kv';
import type { SiteConfigSink } from '../kv';
import type { ControlStore, KvIssueDoc, SiteDoc } from '../store/types';

export type SyncResult = { ok: true } | { ok: false; pending: true; message: string };

/**
 * KV sync (PROJECT-NOTES decision 18). Two directions, two rules:
 *  - GRANT (new site, new key, resume, extra host): Cloudflare KV first. If KV refuses, nothing is changed
 *    and the customer sees why (503). So a key or host is never shown before the collector accepts it.
 *  - REVOKE (revoke key, pause, delete): MongoDB first, then KV. A KV failure is remembered in kv_outbox,
 *    shown in the dashboard, and retried by the reconciler until KV matches MongoDB again.
 */
export function createKvSync(store: ControlStore, kv: SiteConfigSink, now: () => Date) {
  /** Grant: write to KV before anything is saved; a refusal ends the request with 503. */
  const activateFirst = async (site: SiteDoc, onlyKeys?: string[]) => {
    try {
      if (onlyKeys) await putKeys(kv, site, onlyKeys);
      else await syncSite(kv, site);
    } catch (error) {
      const message = kvProblem(error);
      logError('kv_activate_failed', { site: site._id, message });
      throw new HttpError(503, 'activation_failed', `${message} Nothing was changed.`);
    }
  };

  /** Revoke (or repair): write the site as saved; a failure is remembered for the retry. */
  const sync = async (site: SiteDoc): Promise<SyncResult> => {
    try {
      await syncSite(kv, site);
      await store.clearKvIssue(site._id);
      return { ok: true };
    } catch (error) {
      const message = kvProblem(error);
      logError('kv_sync_failed', { site: site._id, message });
      await store.recordKvIssue(site._id, site.tenantId, message, now());
      return { ok: false, pending: true, message: `${message} Your change is saved and reaches the collector automatically once Cloudflare accepts it.` };
    }
  };

  /**
   * Undo of a half-done grant: KV is rewritten from the site as MongoDB has it NOW (re-read), never from the
   * copy loaded at the start of the request: a key revoked meanwhile must not be written back.
   */
  const resyncFresh = async (siteId: number, keysIfGone: string[] = []) => {
    const fresh = await store.siteById(siteId);
    if (fresh) await sync(fresh);
    // The site was deleted meanwhile (its account was deleted in another tab): what we just activated must go.
    else if (keysIfGone.length) await deleteKeys(kv, keysIfGone);
  };

  /** Re-sync sites with an outstanding KV issue from MongoDB (the source of truth). Returns how many are fixed. */
  const reconcileIssues = async (tenantId: ObjectId | null, limit: number) => {
    let fixed = 0;
    for (const issue of await store.kvIssues(tenantId, limit)) {
      const site = await store.siteById(issue._id);
      if (!site) {
        await store.clearKvIssue(issue._id);
        continue;
      }
      if ((await sync(site)).ok) fixed += 1;
    }
    return fixed;
  };

  /** Dashboard loads retry a tenant's KV issues by themselves, at most once a minute per server instance. */
  const lastAutoRetry = new Map<string, number>();
  const issuesOf = async (tenantId: ObjectId): Promise<KvIssueDoc[]> => {
    let issues = await store.kvIssues(tenantId, 20);
    const key = tenantId.toHexString();
    if (issues.length && Date.now() - (lastAutoRetry.get(key) ?? 0) > 60_000) {
      lastAutoRetry.set(key, Date.now());
      if (lastAutoRetry.size > 10_000) lastAutoRetry.clear();
      // A few only: this runs inside a dashboard request (Vercel limit 30 s); "Retry now" and the cron do more.
      await reconcileIssues(tenantId, 3);
      issues = await store.kvIssues(tenantId, 20);
    }
    return issues;
  };

  /** An issue as the dashboard's banner shows it. */
  const issueView = async (issue: KvIssueDoc) => {
    const site = await store.siteById(issue._id);
    return {
      siteId: issue._id,
      domain: site?.domain ?? String(issue._id),
      deleted: site?.status === 'deleted',
      error: issue.error,
      since: issue.createdAt.toISOString(),
      attempts: issue.attempts,
    };
  };

  /** Grant that went wrong after KV accepted it: take the new keys out again and restore KV from MongoDB. */
  const rollbackGrant = async (site: SiteDoc, newKeys: string[]) => {
    if (newKeys.length) await deleteKeys(kv, newKeys);
    await resyncFresh(site._id, site.keys.map((k) => k.publicKey));
  };

  return { activateFirst, sync, resyncFresh, rollbackGrant, reconcileIssues, issuesOf, issueView };
}
export type KvSyncService = ReturnType<typeof createKvSync>;
