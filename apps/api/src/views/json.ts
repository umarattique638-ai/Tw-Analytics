/**
 * What clients see of stored documents. Every answer is built here, so it is easy to check that nothing
 * private (identity secrets, password hashes, CSV bodies) is ever sent.
 */
import type { ObjectId } from 'mongodb';
import { allowedHostsFor } from '../lib/domain';
import type { AuditDoc } from '../models/audit.model';
import type { ExportDoc } from '../models/export.model';
import type { KvIssueDoc } from '../models/kv-issue.model';
import type { Setup } from '../models/setup.model';
import type { SiteDoc } from '../models/site.model';
import type { TenantDoc } from '../models/tenant.model';
import type { UserDoc } from '../models/user.model';
import { SETUP_TTL_DAYS } from '../repositories/setup-store';
import { snippetsFor } from './snippets';

/** A site. Never the identity secret. */
export function siteView(site: SiteDoc) {
  const active = site.keys.filter((k) => k.status === 'active');
  return {
    id: site._id,
    domain: site.domain,
    timezone: site.timezone,
    allowedHosts: site.allowedHosts,
    status: site.status,
    region: site.region,
    verifiedAt: site.verifiedAt?.toISOString() ?? null,
    createdAt: site.createdAt.toISOString(),
    retentionDays: site.retentionDays,
    /** The key new snippets use: the newest active one. */
    publicKey: active[active.length - 1]?.publicKey ?? null,
    keys: site.keys.map((k) => ({
      id: k.id,
      publicKey: k.publicKey,
      status: k.status,
      createdAt: k.createdAt.toISOString(),
      revokedAt: k.revokedAt?.toISOString() ?? null,
    })),
  };
}

/** A saved report, without its CSV. */
export function exportView(e: Omit<ExportDoc, 'csv'>) {
  return {
    id: e._id.toHexString(),
    range: e.range,
    from: e.from,
    to: e.to,
    timezone: e.timezone,
    filename: e.filename,
    rows: e.rows,
    bytes: e.bytes,
    createdAt: e.createdAt.toISOString(),
    expiresAt: e.expiresAt.toISOString(),
  };
}

export const userView = (u: UserDoc) => ({ id: u._id.toHexString(), email: u.email, name: u.name ?? null });

/** One activity-log entry; `me` marks the reader's own actions as "You". */
export function auditView(e: AuditDoc, me: ObjectId, domains: Map<number, string>) {
  return {
    id: e._id.toHexString(),
    at: e.at.toISOString(),
    action: e.action,
    actor: { kind: e.actorKind, name: e.actorName, you: !!e.actorId && e.actorId.equals(me) },
    siteId: e.siteId,
    domain: e.siteId !== null ? (domains.get(e.siteId) ?? null) : null,
    summary: e.summary,
  };
}

/** Cursor of the activity log: "<ms>.<id>" of the last entry shown (validators/account.validator reads it). */
export const auditCursor = (e: AuditDoc) => `${e.at.getTime()}.${e._id.toHexString()}`;

/** A site whose Cloudflare KV copy may be out of date, as the dashboard's banner shows it. */
export function kvIssueView(issue: KvIssueDoc, site: SiteDoc | null) {
  return {
    siteId: issue._id,
    domain: site?.domain ?? String(issue._id),
    deleted: site?.status === 'deleted',
    error: issue.error,
    since: issue.createdAt.toISOString(),
    attempts: issue.attempts,
  };
}

/** The signed-in user's workspace. */
export const tenantView = (t: TenantDoc) => ({ id: t._id.toHexString(), plan: t.plan, region: t.region });

/** A site being set up, with the snippet to paste and when the setup expires. */
export function setupView(setup: Setup, collectorUrl: string) {
  return {
    domain: setup.domain,
    timezone: setup.timezone,
    allowedHosts: allowedHostsFor(setup.domain),
    publicKey: setup.publicKey,
    startedAt: setup.startedAt,
    expiresAt: new Date(new Date(setup.startedAt).getTime() + SETUP_TTL_DAYS * 86_400_000).toISOString(),
    snippets: snippetsFor(collectorUrl, setup.publicKey),
  };
}
