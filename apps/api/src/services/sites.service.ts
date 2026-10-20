import { ObjectId } from 'mongodb';
import { RETENTION_CHOICES } from '../config';
import { MAX_ALLOWED_HOSTS } from '../lib/constants';
import { allowedHostsFor } from '../lib/domain';
import { HttpError, errorText, logError } from '../http/errors';
import { DuplicateError } from '../repositories/control-store';
import type { KeyDoc, SiteDoc, SitePatch } from '../models/site.model';
import type { MembershipDoc } from '../models/tenant.model';
import type { SitePatchInput } from '../validators/site.validator';
import { domainInput, hostInput } from '../validators/site.validator';
import { advanceErasure } from './jobs.service';
import { current, watched } from './health.service';
import { VerifyInputError, probeDomain, runActiveCheck } from './verifier';
import type { Actor, Services } from './types';

const revokeAll = (keys: KeyDoc[], at: Date) => keys.map((k) => ({ ...k, status: 'revoked' as const, revokedAt: k.revokedAt ?? at }));
const canManage = (role: MembershipDoc['role'] | undefined) => role === 'owner' || role === 'admin';

/**
 * The workspace's sites: list, change, delete, move to a new domain, health. Every stored site is
 * verified: adding one is services/setup.service.ts, which saves it only after every install check passed
 * (decision 25).
 */
export function createSitesService(s: Services) {
  const { store, config, kvSync, audit, now, health, limits } = s;

  /** The site with this id, if it belongs to the workspace; 404 otherwise (never "forbidden"). */
  const load = async (actor: Actor, id: number): Promise<SiteDoc> => {
    const site = await store.site(actor.tenant._id, id);
    if (!site) throw new HttpError(404, 'not_found', 'No such site.');
    return site;
  };

  /** Saves a change, unless the site changed since it was loaded (another tab): then 409. */
  const patch = async (actor: Actor, site: SiteDoc, change: SitePatch): Promise<SiteDoc> => {
    const updated = await store.updateSite(actor.tenant._id, site._id, site.updatedAt, change, now());
    if (!updated) throw new HttpError(409, 'conflict', 'This site changed in another tab. Reload and try again.');
    return updated;
  };

  /** The signed-in user's role in the signed-in workspace. */
  const roleOf = async (actor: Actor): Promise<MembershipDoc['role'] | undefined> => {
    const tenantId = actor.tenant._id;
    return (await store.membershipsOf(actor.user._id)).find((m) => m.tenantId.equals(tenantId))?.role;
  };

  /** The checked change of PATCH /sites/:id. Retention needs the owner or an admin role. */
  const patchFrom = async (actor: Actor, input: SitePatchInput): Promise<SitePatch> => {
    const change: SitePatch = {};
    if (input.timezone !== undefined) change.timezone = input.timezone;
    if (input.status !== undefined) change.status = input.status;
    if (input.retentionDays !== undefined) {
      // Shortening retention deletes data: owners and admins only (viewers come with invites).
      if (!canManage(await roleOf(actor))) throw new HttpError(403, 'not_allowed', 'Only the owner or an admin can change how long data is kept.');
      const days = Number(input.retentionDays);
      const allowed = RETENTION_CHOICES.filter((d) => d <= config.retentionDays) as number[];
      if (!allowed.includes(days)) throw new HttpError(400, 'invalid_retention', `Keep data for ${allowed.join(', ')} days.`);
      change.retentionDays = days;
    }
    return change;
  };

  /** Delete a site AND everything collected for it, now and for good (an erasure record, like an account). */
  const erase = async (actor: Actor, site: SiteDoc) => {
    if (!canManage(await roleOf(actor))) throw new HttpError(403, 'not_allowed', 'Only the owner or an admin can delete collected data.');
    if (!s.eraser) {
      throw new HttpError(503, 'erase_unavailable', 'Deleting collected data is not set up on the server (TW_CH_PRUNE_PASSWORD). Nothing was changed; you can still delete the site and keep its data.');
    }
    const at = now();
    const erasure = await store.eraseSite(
      {
        _id: new ObjectId(),
        email: null,
        name: null,
        requestedAt: at,
        status: 'pending',
        kvDoneAt: null,
        dataDeleteSentAt: null,
        dataVerifiedAt: null,
        rowsFound: null,
        rowsAfterCompletion: 0,
        attempts: 0,
        lastError: null,
        completedAt: null,
        updatedAt: at,
      },
      actor.tenant._id,
      site._id,
    );
    if (!erasure) throw new HttpError(404, 'not_found', 'No such site.');
    // First step now (keys removed, ClickHouse deletes sent); the nightly job finishes and checks it.
    const progress = await advanceErasure({ store, kv: s.kv, eraser: s.eraser, mailer: s.mailer }, erasure, at, { finish: false, dataBudgetMs: 20_000, deleteFirst: true }).catch((error) => {
      logError('site_erase_start_failed', { site: site._id, message: errorText(error) });
      return erasure;
    });
    await audit.record(actor, 'site.deleted', site, `Deleted ${site.domain} and all its collected data (erased for good; it cannot be brought back)`);
    return { sync: { ok: !!progress.kvDoneAt }, erased: true };
  };

  return {
    load,
    patch,
    roleOf,

    /** Every site of the workspace with its health, and the sites whose Cloudflare copy may be out of date. */
    async list(actor: Actor) {
      const tenantId = actor.tenant._id;
      const issues = await kvSync.issuesOf(tenantId);
      const sites = await store.sitesOf(tenantId);
      const stored = new Map((await store.healthOf(sites.map((x) => x._id))).map((h) => [h._id, h]));
      return { sites: sites.map((site) => ({ site, health: current(site, stored.get(site._id)) })), issues: await kvSync.withSites(issues) };
    },

    /**
     * Is this site still sending data (decision 28)? The stored result, re-checked when it is older than an
     * hour. A failure to check is not an error for the dashboard: it shows the last known state.
     */
    async health(actor: Actor, site: SiteDoc) {
      let h = await health.stored(site);
      if (health.configured && watched(site) && health.stale(site, h) && limits.health.take(`t:${actor.tenant._id.toHexString()}`, Date.now())) {
        try {
          h = await health.checkOne(site);
        } catch (error) {
          logError('health_check_failed', { site: site._id, message: errorText(error) });
        }
      }
      return h;
    },

    /** "Check again" on the banner: now, whatever the age of the stored result. */
    async checkHealth(actor: Actor, site: SiteDoc) {
      if (!health.configured) throw new HttpError(503, 'health_unavailable', 'The health check needs ClickHouse, which is not configured on the server.');
      if (!watched(site)) return health.stored(site);
      if (!limits.healthCheck.take(`t:${actor.tenant._id.toHexString()}`, Date.now())) {
        throw new HttpError(429, 'rate_limited', 'Too many checks. Wait a few minutes and try again.');
      }
      try {
        return await health.checkOne(site);
      } catch (error) {
        logError('health_check_failed', { site: site._id, message: errorText(error) });
        throw new HttpError(503, 'health_failed', 'We could not check right now. Try again in a minute.');
      }
    },

    /** "Retry now" on the dashboard's Cloudflare warning: re-sync every site of this account with an issue. */
    async syncAll(actor: Actor) {
      const tenantId = actor.tenant._id;
      await kvSync.reconcileIssues(tenantId, 10);
      return kvSync.withSites(await store.kvIssues(tenantId, 50));
    },

    /** What adding this domain would register: the form shows it before submit (rules stay here). */
    preview: (domain: string) => ({ domain, allowedHosts: allowedHostsFor(domain) }),

    /** PATCH /sites/:id: timezone, retention, pause / resume. One activity line per thing that really changed. */
    async update(actor: Actor, site: SiteDoc, input: SitePatchInput) {
      const change = await patchFrom(actor, input);

      const log = async (updated: SiteDoc) => {
        if (change.timezone && change.timezone !== site.timezone) {
          await audit.record(actor, 'site.timezone_changed', updated, `Changed the timezone of ${site.domain} from ${site.timezone} to ${change.timezone}`);
        }
        if (change.retentionDays && change.retentionDays !== site.retentionDays) {
          const shorter = change.retentionDays < site.retentionDays;
          await audit.record(
            actor,
            'site.retention_changed',
            updated,
            `Changed how long ${site.domain} keeps data from ${site.retentionDays} to ${change.retentionDays} days${shorter ? ' (older data is deleted within a week)' : ''}`,
          );
        }
        if (change.status && change.status !== site.status) {
          await audit.record(actor, change.status === 'paused' ? 'site.paused' : 'site.resumed', updated, `${change.status === 'paused' ? 'Paused' : 'Resumed'} tracking on ${site.domain}`);
        }
      };

      if (change.status === 'active' && site.status !== 'active') {
        // Resume = grant: the collector must accept the key again before the dashboard says so.
        await kvSync.activateFirst({ ...site, ...change } as SiteDoc);
        const updated = await patch(actor, site, change).catch(async (error) => {
          await kvSync.rollbackGrant(site, []);
          throw error;
        });
        await log(updated);
        return { site: updated, sync: { ok: true } };
      }
      const updated = await patch(actor, site, change);
      const sync = change.status ? await kvSync.sync(updated) : { ok: true };
      await log(updated);
      return { site: updated, sync };
    },

    /**
     * Delete a site. Two choices (the dialog asks):
     *   keep data (default): tracking stops, the site leaves the account, collected data follows the site's
     *     retention, and adding the domain again brings it back.
     *   eraseData: the site AND everything collected for it are deleted now, for good. Owners and admins
     *     only. It becomes an erasure record (like a deleted account): KV keys go and the ClickHouse deletes
     *     are sent right away; the nightly job repeats both until nothing is left, then watches for late
     *     rows (queue retries) for a while.
     */
    async remove(actor: Actor, site: SiteDoc, eraseData: boolean) {
      if (eraseData) return erase(actor, site);
      const updated = await patch(actor, site, { status: 'deleted', keys: revokeAll(site.keys, now()) });
      const sync = await kvSync.sync(updated);
      await audit.record(actor, 'site.deleted', updated, `Deleted ${site.domain} (tracking stopped; collected data is kept for ${site.retentionDays} days)`);
      return { sync, erased: false };
    },

    /** Writes the site to Cloudflare KV again, as MongoDB has it. */
    sync: (site: SiteDoc) => kvSync.sync(site),

    /**
     * Decision 29: the site moved to a new domain (shop.com -> shop.pk). The new domain must pass the install
     * check with this site's own key first; then the site keeps its id, keys and history and accepts only the
     * new domain (and its subdomains). Owners and admins. Nothing changes when a check fails.
     */
    async changeDomain(actor: Actor, site: SiteDoc, rawDomain: unknown) {
      if (!canManage(await roleOf(actor))) throw new HttpError(403, 'forbidden', 'Only the owner or an admin can change the domain.');
      if (site.status !== 'active') throw new HttpError(409, 'site_paused', 'Resume tracking first, then change the domain.');
      const domain = domainInput(rawDomain);
      if (domain === site.domain) throw new HttpError(400, 'same_domain', `${domain} is already this site's domain.`);
      const tenantId = actor.tenant._id;
      const other = await store.siteByDomain(tenantId, domain);
      if (other && other.status !== 'deleted') throw new HttpError(409, 'domain_taken', `${domain} is already one of your sites.`);
      if (other) throw new HttpError(409, 'domain_deleted', `${domain} was one of your sites before. Add it again from "Add a site" to bring its history back.`);
      const tenantKey = `t:${tenantId.toHexString()}`;
      if (!limits.verify.take(tenantKey, Date.now())) throw new HttpError(429, 'rate_limited', 'Too many checks. Wait a few minutes and try again.');

      if (config.checkDomainReachable) {
        const probe = await probeDomain(domain, { allowPrivate: config.verifierAllowPrivate, ...s.deps.verifier });
        if (!probe.ok) throw new HttpError(400, 'domain_unreachable', `We couldn't reach ${domain} (${probe.why}). Check the spelling; the new site must be online.`);
      }
      const target = { domain, allowedHosts: allowedHostsFor(domain), keys: site.keys };
      let result;
      try {
        result = await runActiveCheck(target, undefined, { allowPrivate: config.verifierAllowPrivate, ...s.deps.verifier });
      } catch (error) {
        if (error instanceof VerifyInputError) throw new HttpError(400, 'invalid_url', error.message);
        throw error;
      }
      if (!result.ok) return { result, site: null };

      const at = now();
      // verifiedAt = now: the health check starts fresh for the new domain (a new site's 24 hours).
      const change: SitePatch = { domain, allowedHosts: allowedHostsFor(domain), verifiedAt: at };
      await kvSync.activateFirst({ ...site, ...change } as SiteDoc);
      let updated: SiteDoc;
      try {
        updated = await patch(actor, site, change);
      } catch (error) {
        await kvSync.rollbackGrant(site, []);
        if (error instanceof DuplicateError && error.field === 'domain') throw new HttpError(409, 'domain_taken', `${domain} is already one of your sites.`);
        throw error;
      }
      await audit.record(actor, 'site.domain_changed', updated, `Changed the domain of ${site.domain} to ${domain} (its history is kept; visits from ${site.domain} no longer count)`);
      return { result, site: updated };
    },

    /**
     * Adds a host to the site's accepted hosts (KV synced). API only: the dashboard's "Allow host" button was
     * removed (decision 29). Owners and admins, like the domain change.
     */
    async allowHost(actor: Actor, site: SiteDoc, rawHost: unknown) {
      if (!canManage(await roleOf(actor))) throw new HttpError(403, 'forbidden', 'Only the owner or an admin can add a host.');
      const host = hostInput(rawHost);
      if (site.allowedHosts.includes(host)) return { site, sync: { ok: true } };
      if (site.allowedHosts.length >= MAX_ALLOWED_HOSTS) throw new HttpError(409, 'too_many_hosts', `A site can accept at most ${MAX_ALLOWED_HOSTS} hosts.`);
      const next: SiteDoc = { ...site, allowedHosts: [...site.allowedHosts, host] };
      await kvSync.activateFirst(next);
      const updated = await patch(actor, site, { allowedHosts: next.allowedHosts }).catch(async (error) => {
        await kvSync.rollbackGrant(site, []);
        throw error;
      });
      await audit.record(actor, 'host.allowed', updated, `Allowed ${host} to send data for ${site.domain}`);
      return { site: updated, sync: { ok: true } };
    },
  };
}
export type SitesService = ReturnType<typeof createSitesService>;
