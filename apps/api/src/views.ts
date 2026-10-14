/**
 * What clients see of stored documents. Every answer is built here, so it is easy to check that nothing
 * private (identity secrets, password hashes, CSV bodies) is ever sent.
 */
import { ObjectId } from 'mongodb';
import type { AuditDoc, ExportDoc, SiteDoc, UserDoc } from './store/types';

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

/** Cursor of the activity log: "<ms>.<id>" of the last entry shown. */
export const auditCursor = (e: AuditDoc) => `${e.at.getTime()}.${e._id.toHexString()}`;
export function parseAuditCursor(raw: string | undefined): { at: Date; id: ObjectId } | undefined {
  const m = /^(\d{1,15})\.([0-9a-f]{24})$/.exec(raw ?? '');
  return m ? { at: new Date(Number(m[1])), id: new ObjectId(m[2]) } : undefined;
}

// ------------------------------------------------------------------ words for the activity log

/** "tw_pub_AbC1…": enough to tell keys apart in the activity log, never the whole key. */
export const shortKey = (k: string) => `${k.slice(0, 11)}…`;
export const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
/** count(2, 'site') -> "2 sites". */
export const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
