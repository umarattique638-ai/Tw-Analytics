import { allowedHostsFor, canonicalTimezone, normalizeDomain } from '../lib/domain';
import { HttpError } from '../http/errors';
import { body, clientIp, str } from '../http/request';
import type { Api, Ctx } from '../http/types';
import { newIdentitySecret, newKeyId, newPublicKey } from '../lib/secrets';
import type { Services } from '../services';
import { SETUP_TTL_DAYS } from '../services/setup';
import type { Setup } from '../services/setup';
import { snippetsFor } from '../views/snippets';
import { VerifyInputError, probeDomain, runActiveCheck } from '../services/verifier';
import { siteView } from '../views/json';
import { DuplicateError } from '../repositories/control-store';
import type { KeyDoc, SiteDoc, SitePatch } from '../models/site.model';

const invalidDomain = () => new HttpError(400, 'invalid_domain', 'Enter a domain like example.com (no IP addresses or localhost).');
const invalidTimezone = () => new HttpError(400, 'invalid_timezone', 'Choose a timezone from the list.');
const domainTaken = (domain: string) => new HttpError(409, 'domain_taken', `${domain} is already one of your sites.`);
const noSetup = () => new HttpError(404, 'no_setup', 'No site is being set up. Add your site first.');

/**
 * Adding a site (decision 25). The site is saved in MongoDB only at the very end, when every install check
 * passed. Before that nothing is stored in our databases: the setup lives in
 * Cloudflare KV entries that expire by themselves (services/setup.ts).
 *
 *   POST   /setup          start: domain + timezone -> key + snippet (nothing answers at the domain: refused)
 *   GET    /setup          the setup in progress and its snippet
 *   POST   /setup/verify   run the checks; all pass -> the site is created, verified
 *   DELETE /setup          cancel: the key stops working, nothing is left
 */
export function setupController(app: Api, s: Services) {
  const { store, config, setup, kvSync, audit, limits, now, deps } = s;

  const view = async (current: Setup) => ({
    domain: current.domain,
    timezone: current.timezone,
    allowedHosts: allowedHostsFor(current.domain),
    publicKey: current.publicKey,
    startedAt: current.startedAt,
    expiresAt: new Date(new Date(current.startedAt).getTime() + SETUP_TTL_DAYS * 86_400_000).toISOString(),
    snippets: snippetsFor(config.collectorUrl, current.publicKey),
  });

  const rateLimited = (c: Ctx) =>
    !limits.verify.take(`t:${c.get('tenant')._id.toHexString()}`, Date.now()) || !limits.verifyIp.take(`ip:${clientIp(c)}`, Date.now());

  app.get('/setup', async (c) => {
    const current = await setup.get(c.get('tenant')._id);
    return c.json({ setup: current ? await view(current) : null });
  });

  app.post('/setup', async (c) => {
    const b = await body(c);
    const domain = normalizeDomain(str(b.domain));
    if (!domain) throw invalidDomain();
    const timezone = canonicalTimezone(str(b.timezone));
    if (!timezone) throw invalidTimezone();
    const tenantId = c.get('tenant')._id;

    const existing = await store.siteByDomain(tenantId, domain);
    if (existing && existing.status !== 'deleted') throw domainTaken(domain);

    // The same domain again: continue with the same key, so the snippet already pasted stays valid.
    const current = await setup.get(tenantId);
    if (current?.domain === domain) {
      const next = { ...current, timezone };
      if (timezone !== current.timezone) await setup.update(tenantId, next);
      return c.json({ setup: await view(next), resumed: true });
    }

    if (rateLimited(c)) throw new HttpError(429, 'rate_limited', 'Too many tries. Wait a few minutes and try again.');
    // A typo or an invented domain is refused here, before anything is created.
    if (config.checkDomainReachable) {
      const probe = await probeDomain(domain, { allowPrivate: config.verifierAllowPrivate, ...deps.verifier });
      if (!probe.ok) {
        throw new HttpError(400, 'domain_unreachable', `We couldn't reach ${domain} (${probe.why}). Check the spelling; the site must be online before you add it.`);
      }
    }

    // One setup at a time: a different domain replaces the earlier one (its key stops working).
    if (current) await setup.cancel(tenantId, current);
    const next: Setup = { domain, timezone, publicKey: newPublicKey(), startedAt: now().toISOString() };
    await setup.start(tenantId, next);
    return c.json({ setup: await view(next) }, 201);
  });

  app.delete('/setup', async (c) => {
    const tenantId = c.get('tenant')._id;
    const current = await setup.get(tenantId);
    if (current) await setup.cancel(tenantId, current);
    return c.json({ ok: true });
  });

  /**
   * The install check. It stops at the first failing step. When every step passed, the site is written to
   * MongoDB (verified from the start) and the dashboard opens; no waiting for a first pageview.
   */
  app.post('/setup/verify', async (c) => {
    const tenantId = c.get('tenant')._id;
    const current = await setup.get(tenantId);
    if (!current) throw noSetup();
    if (rateLimited(c)) throw new HttpError(429, 'rate_limited', 'Too many checks. Wait a few minutes and try again.');
    const b = await body(c);
    const target = { domain: current.domain, allowedHosts: allowedHostsFor(current.domain), keys: [{ publicKey: current.publicKey, status: 'active' }] };
    let result;
    try {
      result = await runActiveCheck(target, str(b.url) || undefined, { allowPrivate: config.verifierAllowPrivate, ...deps.verifier });
    } catch (error) {
      if (error instanceof VerifyInputError) throw new HttpError(400, 'invalid_url', error.message);
      throw error;
    }
    const site = result.ok ? await createVerified(c, current) : null;
    return c.json({ ...result, verifiedAt: site?.verifiedAt?.toISOString() ?? null, site: site ? siteView(site) : null });
  });

  /** Saving failed after the key entry was rewritten: the key goes back to "setup" (nothing is stored). */
  const backToSetup = (tenantId: SiteDoc['tenantId'], current: Setup) => setup.start(tenantId, current).catch(() => undefined);

  /** Every check passed: NOW the site is saved (KV first, then MongoDB). */
  const createVerified = async (c: Ctx, current: Setup): Promise<SiteDoc> => {
    const tenant = c.get('tenant');
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
      await audit.record(c, 'site.restored', site, `Added ${site.domain} again after every install check passed (its earlier data is back)`);
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
      await audit.record(c, 'site.created', site, `Added ${site.domain} (timezone ${site.timezone}) after every install check passed`);
    }
    await setup.finish(tenant._id);
    return site;
  };
}
