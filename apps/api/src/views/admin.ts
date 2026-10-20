/**
 * What the super admin pages (/admin) see. Never password hashes, identity secrets or session tokens; site
 * keys only shortened (the full key is in the customer's own snippet, not needed here).
 */
import type { AuditDoc } from '../models/audit.model';
import type { KvIssueDoc } from '../models/kv-issue.model';
import type { SiteDoc } from '../models/site.model';
import type { SiteHealthDoc } from '../models/site-health.model';
import type { AdminAccount } from '../services/admin.service';
import { shortKey } from '../lib/text';
import { kvIssueView } from './json';
import { healthView } from './site-health';

const owner = (a: AdminAccount) => a.members.find((m) => m.role === 'owner')?.user ?? a.members[0]?.user ?? null;

/** One row of the accounts table. */
export function adminAccountRow(a: AdminAccount) {
  const o = owner(a);
  const live = a.sites.filter((s) => s.status !== 'deleted');
  return {
    id: a.tenant._id.toHexString(),
    owner: o ? { name: o.name ?? null, email: o.email } : null,
    plan: a.tenant.plan,
    status: a.tenant.status,
    createdAt: a.tenant.createdAt.toISOString(),
    members: a.members.length,
    sites: live.map((s) => ({ id: s._id, domain: s.domain, status: s.status })),
    deletedSites: a.sites.length - live.length,
  };
}

/** A site in the account page, with its health and keys (shortened). */
function adminSite(site: SiteDoc, health: SiteHealthDoc | null) {
  return {
    id: site._id,
    domain: site.domain,
    status: site.status,
    timezone: site.timezone,
    retentionDays: site.retentionDays,
    createdAt: site.createdAt.toISOString(),
    verifiedAt: site.verifiedAt?.toISOString() ?? null,
    keys: site.keys.map((k) => ({ key: shortKey(k.publicKey), status: k.status })),
    health: site.status === 'deleted' ? null : healthView(site, health),
  };
}

/** The account page: people, sites, the latest activity and any Cloudflare KV problem. */
export function adminAccountView(a: AdminAccount & { health: Map<number, SiteHealthDoc | null>; activity: AuditDoc[]; issues: { issue: KvIssueDoc; site: SiteDoc | null }[] }) {
  return {
    ...adminAccountRow(a),
    region: a.tenant.region,
    people: a.members.map((m) => ({
      id: m.user._id.toHexString(),
      name: m.user.name ?? null,
      email: m.user.email,
      role: m.role,
      verified: m.user.emailVerifiedAt !== null,
      status: m.user.status,
      createdAt: m.user.createdAt.toISOString(),
    })),
    siteList: a.sites.map((s) => adminSite(s, a.health.get(s._id) ?? null)),
    activity: a.activity.map((e) => ({ id: e._id.toHexString(), at: e.at.toISOString(), action: e.action, who: e.actorName, siteId: e.siteId, summary: e.summary })),
    kvIssues: a.issues.map(({ issue, site }) => kvIssueView(issue, site)),
  };
}
