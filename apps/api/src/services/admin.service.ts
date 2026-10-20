import type { ObjectId } from 'mongodb';
import { HttpError } from '../http/errors';
import type { RangeKey } from '../repositories/stats';
import type { MembershipDoc, TenantDoc } from '../models/tenant.model';
import type { SiteDoc } from '../models/site.model';
import type { UserDoc } from '../models/user.model';
import { current } from './health.service';
import type { Actor, Services } from './types';

/** A workspace as the super admin sees it: its people and its sites. */
export interface AdminAccount {
  tenant: TenantDoc;
  members: { user: UserDoc; role: MembershipDoc['role'] }[];
  sites: SiteDoc[];
}

/**
 * Super admin (owner, 2026-10-20): the TailWatch team sees every account and can delete an account or a
 * site, or download a site's report. Who is a super admin is server configuration (TW_ADMIN_EMAILS), never
 * something stored that an account could change. Customers see in their activity log when the team
 * downloaded one of their reports or deleted one of their sites.
 */
export function createAdminService(s: Services) {
  const { store, config, sites, stats, account, audit, kvSync } = s;

  /** A super admin: listed in the configuration, with a confirmed address. */
  const isSuperAdmin = (user: UserDoc) => config.superAdmins.includes(user.emailNormalized) && user.emailVerifiedAt !== null;

  /** Every workspace with its people and sites, in five reads (not one per workspace). */
  const everything = async (): Promise<AdminAccount[]> => {
    const [tenants, memberships, allSites] = await Promise.all([store.allTenants(), store.allMemberships(), store.allSites()]);
    const ids = [...new Map(memberships.map((m) => [m.userId.toHexString(), m.userId])).values()];
    const users = new Map((await store.usersByIds(ids)).map((u) => [u._id.toHexString(), u]));
    return tenants.map((tenant) => ({
      tenant,
      members: memberships
        .filter((m) => m.tenantId.equals(tenant._id))
        .flatMap((m) => {
          const user = users.get(m.userId.toHexString());
          return user ? [{ user, role: m.role }] : [];
        }),
      sites: allSites.filter((x) => x.tenantId.equals(tenant._id)),
    }));
  };

  /** One workspace, or 404. */
  const accountOf = async (tenantId: ObjectId): Promise<AdminAccount> => {
    const tenant = await store.tenantById(tenantId);
    if (!tenant) throw new HttpError(404, 'not_found', 'No such account.');
    const memberships = await store.membersOf(tenantId);
    const users = await store.usersByIds(memberships.map((m) => m.userId));
    return {
      tenant,
      members: memberships.flatMap((m) => {
        const user = users.find((u) => u._id.equals(m.userId));
        return user ? [{ user, role: m.role }] : [];
      }),
      sites: await store.sitesOf(tenantId, true),
    };
  };

  /** Any stored site (deleted ones too), or 404. */
  const siteOf = async (siteId: number): Promise<SiteDoc> => {
    const site = await store.siteById(siteId);
    if (!site) throw new HttpError(404, 'not_found', 'No such site.');
    return site;
  };

  return {
    isSuperAdmin,

    /** The numbers at the top of /admin. */
    async overview() {
      const [all, broken, kvIssues, erasures] = await Promise.all([
        everything(),
        store.allSites().then(async (list) => {
          const watched = list.filter((x) => x.status === 'active' && x.verifiedAt);
          const health = await store.healthOf(watched.map((x) => x._id));
          return watched.filter((x) => current(x, health.find((h) => h._id === x._id))?.status === 'broken').length;
        }),
        store.kvIssues(null, 500).then((list) => list.length),
        store.countPendingErasures(),
      ]);
      const users = new Set(all.flatMap((a) => a.members.map((m) => m.user._id.toHexString())));
      const sitesOf = (status: SiteDoc['status']) => all.reduce((n, a) => n + a.sites.filter((x) => x.status === status).length, 0);
      return {
        accounts: all.length,
        users: users.size,
        sites: { active: sitesOf('active'), paused: sitesOf('paused'), deleted: sitesOf('deleted') },
        brokenSites: broken,
        kvIssues,
        pendingErasures: erasures,
      };
    },

    /** Every account, newest first; `q` finds an e-mail, a name or a domain. */
    async accounts(q: string): Promise<AdminAccount[]> {
      const needle = q.trim().toLowerCase();
      const all = await everything();
      if (!needle) return all;
      return all.filter(
        (a) => a.members.some((m) => m.user.emailNormalized.includes(needle) || (m.user.name ?? '').toLowerCase().includes(needle)) || a.sites.some((x) => x.domain.includes(needle)),
      );
    },

    /** One account: people, every site with its health, and the latest activity. */
    async account(tenantId: ObjectId) {
      const a = await accountOf(tenantId);
      const health = await store.healthOf(a.sites.map((x) => x._id));
      const activity = await store.auditOf(tenantId, { limit: 30 });
      const issues = await kvSync.withSites(await store.kvIssues(tenantId, 50));
      return { ...a, health: new Map(a.sites.map((x) => [x._id, current(x, health.find((h) => h._id === x._id))])), activity, issues };
    },

    /**
     * Delete an account, like its owner can in Settings (no password: the team decided). The owner is
     * e-mailed that the TailWatch team deleted it. Not your own account: that is Settings.
     */
    async deleteAccount(admin: Actor, tenantId: ObjectId) {
      if (admin.tenant._id.equals(tenantId)) throw new HttpError(409, 'own_account', 'This is your own account. Delete it from Settings instead.');
      const a = await accountOf(tenantId);
      const owner = a.members.find((m) => m.role === 'owner')?.user ?? null;
      return account.eraseWorkspace(
        tenantId,
        owner ? { email: owner.email, name: owner.name ?? null } : null,
        a.members.map((m) => m.user._id),
        true,
      );
    },

    /** Delete a site, keeping its data (tracking stops) or erasing it. The customer's activity log says who. */
    async deleteSite(siteId: number, eraseData: boolean) {
      const site = await siteOf(siteId);
      if (site.status === 'deleted' && !eraseData) throw new HttpError(409, 'already_deleted', 'This site is already deleted. Choose "erase its data" to delete what it collected.');
      return sites.removeByTeam(site, eraseData);
    },

    /** A site's CSV report for a period (not saved). The customer's activity log says the team downloaded it. */
    async report(siteId: number, key: RangeKey) {
      const site = await siteOf(siteId);
      const out = await stats.csv(site, key);
      await audit.write(site.tenantId, null, 'support.report_downloaded', site._id, `The TailWatch team downloaded a report of ${site.domain} (${out.filename})`);
      return out;
    },
  };
}
export type AdminService = ReturnType<typeof createAdminService>;
