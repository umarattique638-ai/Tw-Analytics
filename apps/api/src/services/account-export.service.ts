import type { ObjectId } from 'mongodb';
import { EXPORT_MAX } from '../lib/constants';
import { HttpError } from '../http/errors';
import { addDays, localDate } from '../repositories/stats';
import type { SiteExport } from '../repositories/stats';
import type { Services } from './types';
import type { AuditDoc } from '../models/audit.model';
import type { ControlStore } from '../repositories/control-store';
import type { SiteDoc } from '../models/site.model';
import type { TenantDoc } from '../models/tenant.model';
import type { UserDoc } from '../models/user.model';

/** Sites read from ClickHouse at once (5 queries each): enough for speed, gentle on ClickHouse. */
const SITES_PER_BATCH = 3;
/** Vercel stops a request at 30 s: a very large account gets a clear answer instead of a cut-off file. */
const BUDGET_MS = 22_000;
const ACTIVITY_PAGE = 500;
const ACTIVITY_MAX = 5_000;

/** Each site's analytics over its whole stored history (null without ClickHouse), a few sites at a time. */
async function analyticsOf(s: Services, sites: SiteDoc[], at: Date): Promise<(SiteExport | null)[]> {
  const out: (SiteExport | null)[] = [];
  const deadline = Date.now() + BUDGET_MS;
  for (let i = 0; i < sites.length; i += SITES_PER_BATCH) {
    if (Date.now() > deadline) {
      throw new HttpError(503, 'export_too_large', 'Your account has too much data to download at once. Write to us and we send you the file.');
    }
    out.push(
      ...(await Promise.all(
        sites.slice(i, i + SITES_PER_BATCH).map((site) => {
          if (!s.stats.configured) return Promise.resolve(null);
          const to = localDate(at, site.timezone);
          return s.stats.reading(() => s.stats.reader().exportSite(site._id, site.timezone, addDays(to, -site.retentionDays), to));
        }),
      )),
    );
  }
  return out;
}

/** The activity log, newest first, up to ACTIVITY_MAX entries. */
async function activityOf(store: ControlStore, tenantId: ObjectId): Promise<AuditDoc[]> {
  const activity: AuditDoc[] = [];
  for (let before: { at: Date; id: ObjectId } | undefined; activity.length < ACTIVITY_MAX; ) {
    const page = await store.auditOf(tenantId, { limit: ACTIVITY_PAGE, before });
    activity.push(...page);
    if (page.length < ACTIVITY_PAGE) break;
    const last = page[page.length - 1]!;
    before = { at: last.at, id: last._id };
  }
  return activity;
}

/**
 * "Download your data" (GDPR Art 20, and step 1 of deleting the account): the account, every site (deleted
 * ones too, their data is still stored), each site's analytics over its whole stored history, the list of
 * saved reports and the activity log. Read-only; never the identity secrets. Saved reports are listed, not
 * repeated (they are the same daily numbers).
 */
export async function buildAccountExport(s: Services, tenant: TenantDoc, user: UserDoc, at: Date) {
  const sites = await s.store.sitesOf(tenant._id, true);
  const analytics = await analyticsOf(s, sites, at);
  const reportsBySite = await Promise.all(sites.map((site) => s.store.exportsOf(tenant._id, site._id, at, EXPORT_MAX)));
  const activity = await activityOf(s.store, tenant._id);
  return {
    siteCount: sites.length,
    data: {
      format: 'tailwatch-export/1',
      exportedAt: at.toISOString(),
      notes: [
        "Days are local calendar days in each site's timezone. Visitors per day are exact; visitorsEstimated on pages is an estimate (PLAN 5). Pages: the 1,000 most viewed per site.",
        'TailWatch stores no IP address and no cookie id: visitors are a hash that changes every day, so there is nothing that identifies a person.',
        s.stats.configured ? "analytics covers each site's whole stored history (its retention)." : 'analytics is null: the analytics database is not configured on this server.',
      ],
      user: { name: user.name ?? null, email: user.email, createdAt: user.createdAt.toISOString() },
      workspace: { id: tenant._id.toHexString(), plan: tenant.plan, region: tenant.region, createdAt: tenant.createdAt.toISOString() },
      sites: sites.map((site, i) => ({
        id: site._id,
        domain: site.domain,
        status: site.status,
        timezone: site.timezone,
        retentionDays: site.retentionDays,
        allowedHosts: site.allowedHosts,
        createdAt: site.createdAt.toISOString(),
        verifiedAt: site.verifiedAt?.toISOString() ?? null,
        keys: site.keys.map((k) => ({ publicKey: k.publicKey, status: k.status, createdAt: k.createdAt.toISOString(), revokedAt: k.revokedAt?.toISOString() ?? null })),
        analytics: analytics[i] ?? null,
        reports: reportsBySite[i]!.map((r) => ({ filename: r.filename, range: r.range, from: r.from, to: r.to, rows: r.rows, createdAt: r.createdAt.toISOString() })),
      })),
      activity: activity.map((e) => ({ at: e.at.toISOString(), who: e.actorName, action: e.action, siteId: e.siteId, summary: e.summary })),
    },
  };
}
