import { allowedHostsFor } from '../lib/domain';
import { HttpError } from '../http/errors';
import { newIdentitySecret, newKeyId, newPublicKey } from '../lib/secrets';
import { DuplicateError } from '../repositories/control-store';
import type { KeyDoc, SiteDoc, SitePatch } from '../models/site.model';
import type { Setup } from '../models/setup.model';
import { VerifyInputError, probeDomain, runActiveCheck } from './verifier';
import type { Actor, Services } from './types';

const domainTaken = (domain: string) => new HttpError(409, 'domain_taken', `${domain} is already one of your sites.`);
const noSetup = () => new HttpError(404, 'no_setup', 'No site is being set up. Add your site first.');

/**
 * Adding a site (decision 25). The site is saved in MongoDB only at the very end, when every install check
 * passed. Before that nothing is stored in our databases: the setup lives in Cloudflare KV entries that
 * expire by themselves (repositories/setup-store.ts).
 *
 *   start    domain + timezone -> key + snippet (nothing answers at the domain: refused)
 *   current  the setup in progress
 *   verify   run the checks; all pass -> the site is created, verified
 *   cancel   the key stops working, nothing is left
 */
export function createSetupService(s: Services) {
  const { store, config, setupStore, kvSync, audit, limits, now, deps } = s;

  /** The verifier fetches other people's servers: limited per workspace and per client address. */
  const rateLimited = (actor: Actor, ip: string) =>
    !limits.verify.take(`t:${actor.tenant._id.toHexString()}`, Date.now()) || !limits.verifyIp.take(`ip:${ip}`, Date.now());

  /** Saving failed after the key entry was rewritten: the key goes back to "setup" (nothing is stored). */
  const backToSetup = (tenantId: SiteDoc['tenantId'], current: Setup) => setupStore.start(tenantId, current).catch(() => undefined);

  /** Every check passed: NOW the site is saved (KV first, then MongoDB). */
  const createVerified = async (actor: Actor, current: Setup): Promise<SiteDoc> => {
    const tenant = actor.tenant;
    const at = now();
    const key: KeyDoc = { id: newKeyId(), publicKey: current.publicKey, createdAt: at, revokedAt: null, status: 'active' };
    const existing = await store.siteByDomain(tenant._id, current.domain);
    if (existing && existing.status !== 'deleted') throw domainTaken(current.domain);

    let site: SiteDoc;
    if (existing) {
      // A deleted domain comes back with its history (same site id), on the key just verified.
      const patch: SitePatch = {
        status: 'active',
        timezone: current.timezone,
        allowedHosts: allowedHostsFor(existing.domain),
        identitySecret: newIdentitySecret(),
        keys: [...existing.keys.map((k) => ({ ...k, status: 'revoked' as const, revokedAt: k.revokedAt ?? at })), key],
        verifiedAt: at,
      };
      await kvSync.activateFirst({ ...existing, ...patch } as SiteDoc, [key.publicKey]);
      const updated = await store.updateSite(tenant._id, existing._id, existing.updatedAt, patch, at).catch(async (error) => {
        await backToSetup(tenant._id, current);
        throw error;
      });
      if (!updated) {
        await backToSetup(tenant._id, current);
        throw new HttpError(409, 'conflict', 'This site changed in another tab. Check again.');
      }
      site = updated;
      await audit.record(actor, 'site.restored', site, `Added ${site.domain} again after every install check passed (its earlier data is back)`);
    } else {
      site = {
        _id: await store.nextSiteId(config.siteIdFloor),
        tenantId: tenant._id,
        domain: current.domain,
        timezone: current.timezone,
        allowedHosts: allowedHostsFor(current.domain),
        retentionDays: config.retentionDays,
        status: 'active',
        region: tenant.region,
        verifiedAt: at,
        identitySecret: newIdentitySecret(),
        keys: [key],
        createdAt: at,
        updatedAt: at,
      };
      // The collector entry turns from "setup" into the real site (id, identity secret) first.
      await kvSync.activateFirst(site);
      try {
        await store.insertSite(site);
      } catch (error) {
        await backToSetup(tenant._id, current);
        if (error instanceof DuplicateError && error.field === 'domain') throw domainTaken(current.domain);
        throw error;
      }
      await audit.record(actor, 'site.created', site, `Added ${site.domain} (timezone ${site.timezone}) after every install check passed`);
    }
    await setupStore.finish(tenant._id);
    return site;
  };

  return {
    /** The workspace's setup in progress, or null. */
    current: (actor: Actor) => setupStore.get(actor.tenant._id),

    /**
     * Start adding a site. The same domain again continues with the same key (the snippet already pasted
     * stays valid); a different domain replaces the earlier setup (its key stops working).
     */
    async start(actor: Actor, input: { domain: string; timezone: string }, ip: string): Promise<{ setup: Setup; resumed: boolean }> {
      const { domain, timezone } = input;
      const tenantId = actor.tenant._id;

      const existing = await store.siteByDomain(tenantId, domain);
      if (existing && existing.status !== 'deleted') throw domainTaken(domain);

      const current = await setupStore.get(tenantId);
      if (current?.domain === domain) {
        const next = { ...current, timezone };
        if (timezone !== current.timezone) await setupStore.update(tenantId, next);
        return { setup: next, resumed: true };
      }

      if (rateLimited(actor, ip)) throw new HttpError(429, 'rate_limited', 'Too many tries. Wait a few minutes and try again.');
      // A typo or an invented domain is refused here, before anything is created.
      if (config.checkDomainReachable) {
        const probe = await probeDomain(domain, { allowPrivate: config.verifierAllowPrivate, ...deps.verifier });
        if (!probe.ok) {
          throw new HttpError(400, 'domain_unreachable', `We couldn't reach ${domain} (${probe.why}). Check the spelling; the site must be online before you add it.`);
        }
      }

      if (current) await setupStore.cancel(tenantId, current);
      const next: Setup = { domain, timezone, publicKey: newPublicKey(), startedAt: now().toISOString() };
      await setupStore.start(tenantId, next);
      return { setup: next, resumed: false };
    },

    /** Cancel: the key stops working, nothing is left. */
    async cancel(actor: Actor): Promise<void> {
      const tenantId = actor.tenant._id;
      const current = await setupStore.get(tenantId);
      if (current) await setupStore.cancel(tenantId, current);
    },

    /**
     * The install check. It stops at the first failing step. When every step passed, the site is written to
     * MongoDB (verified from the start) and the dashboard opens; no waiting for a first pageview.
     */
    async verify(actor: Actor, url: string | undefined, ip: string) {
      const current = await setupStore.get(actor.tenant._id);
      if (!current) throw noSetup();
      if (rateLimited(actor, ip)) throw new HttpError(429, 'rate_limited', 'Too many checks. Wait a few minutes and try again.');
      const target = { domain: current.domain, allowedHosts: allowedHostsFor(current.domain), keys: [{ publicKey: current.publicKey, status: 'active' }] };
      let result;
      try {
        result = await runActiveCheck(target, url, { allowPrivate: config.verifierAllowPrivate, ...deps.verifier });
      } catch (error) {
        if (error instanceof VerifyInputError) throw new HttpError(400, 'invalid_url', error.message);
        throw error;
      }
      const site = result.ok ? await createVerified(actor, current) : null;
      return { result, site };
    },
  };
}
export type SetupService = ReturnType<typeof createSetupService>;
