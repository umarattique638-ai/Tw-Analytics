import { RETENTION_CHOICES } from '../config';
import { MAX_ALLOWED_HOSTS, PASSIVE_WINDOW_MINUTES } from '../constants';
import { allowedHostsFor, canonicalTimezone, normalizeDomain } from '../domain';
import { HttpError, analyticsUnavailable, errorText, logError } from '../http/errors';
import { deleteKeys } from '../kv';
import { body, clientIp, str } from '../http/request';
import type { Api, Ctx } from '../http/types';
import { newIdentitySecret, newKeyId, newPublicKey } from '../secrets';
import type { Services } from '../services';
import { snippetsFor } from '../snippets';
import { DuplicateError } from '../store/types';
import type { KeyDoc, SiteDoc, SitePatch } from '../store/types';
import { VerifyInputError, runActiveCheck } from '../verifier';
import { shortKey, siteView } from '../views';

const invalidDomain = () => new HttpError(400, 'invalid_domain', 'Enter a domain like example.com (no IP addresses or localhost).');
const invalidTimezone = () => new HttpError(400, 'invalid_timezone', 'Choose a timezone from the list.');
const domainTaken = (domain: string) => new HttpError(409, 'domain_taken', `${domain} is already one of your sites.`);
const revokeAll = (keys: KeyDoc[], at: Date) => keys.map((k) => ({ ...k, status: 'revoked' as const, revokedAt: k.revokedAt ?? at }));

/** The workspace's sites: list, add (or restore), change, delete, install status and the install check. */
export function siteRoutes(app: Api, s: Services) {
  const { store, config, sites, kvSync, audit, limits, now, deps } = s;
  const newKey = (at: Date): KeyDoc => ({ id: newKeyId(), publicKey: newPublicKey(), createdAt: at, revokedAt: null, status: 'active' });

  app.get('/sites', async (c) => {
    const tenantId = c.get('tenant')._id;
    const issues = await kvSync.issuesOf(tenantId);
    const list = await store.sitesOf(tenantId);
    return c.json({ sites: list.map(siteView), kvIssues: await Promise.all(issues.map(kvSync.issueView)) });
  });

  /** "Retry now" on the dashboard's Cloudflare warning: re-sync every site of this account with an issue. */
  app.post('/sites/sync-all', async (c) => {
    const tenantId = c.get('tenant')._id;
    await kvSync.reconcileIssues(tenantId, 10);
    const issues = await store.kvIssues(tenantId, 50);
    return c.json({ kvIssues: await Promise.all(issues.map(kvSync.issueView)) });
  });

  /** What adding this domain would register: the form shows it before submit (rules stay here). */
  app.get('/sites/preview', (c) => {
    const domain = normalizeDomain(c.req.query('domain') ?? '');
    if (!domain) throw invalidDomain();
    return c.json({ domain, allowedHosts: allowedHostsFor(domain) });
  });

  app.post('/sites', async (c) => {
    const b = await body(c);
    const domain = normalizeDomain(str(b.domain));
    if (!domain) throw invalidDomain();
    const timezone = canonicalTimezone(str(b.timezone));
    if (!timezone) throw invalidTimezone();
    const tenant = c.get('tenant');
    const at = now();

    const existing = await store.siteByDomain(tenant._id, domain);
    if (existing && existing.status !== 'deleted') throw domainTaken(domain);
    const site = existing ? await restoreSite(c, existing, timezone, at) : await insertSite(tenant._id, tenant.region, domain, timezone, at);

    if (existing) await audit.record(c, 'site.restored', site, `Added ${domain} again (its earlier data is back; new key ${shortKey(site.keys[site.keys.length - 1]!.publicKey)})`);
    else await audit.record(c, 'site.created', site, `Added ${domain} (timezone ${timezone})`);
    return c.json({ site: siteView(site), sync: { ok: true } }, 201);
  });

  /**
   * Re-adding a deleted domain restores it: same site id, so its history comes back. Fresh key and
   * secret, because the old ones were revoked on delete.
   */
  const restoreSite = async (c: Ctx, existing: SiteDoc, timezone: string, at: Date) => {
    const fresh = newKey(at);
    const patch: SitePatch = {
      status: 'active',
      timezone,
      allowedHosts: allowedHostsFor(existing.domain),
      identitySecret: newIdentitySecret(),
      keys: [...revokeAll(existing.keys, at), fresh],
    };
    await kvSync.activateFirst({ ...existing, ...patch } as SiteDoc, [fresh.publicKey]);
    try {
      return await sites.patch(c, existing, patch);
    } catch (error) {
      await kvSync.rollbackGrant(existing, [fresh.publicKey]);
      throw error;
    }
  };

  /** A new site: KV first (grant), then MongoDB; if saving fails, KV forgets the key again. */
  const insertSite = async (tenantId: SiteDoc['tenantId'], region: SiteDoc['region'], domain: string, timezone: string, at: Date) => {
    const site: SiteDoc = {
      _id: await store.nextSiteId(config.siteIdFloor),
      tenantId,
      domain,
      timezone,
      allowedHosts: allowedHostsFor(domain),
      retentionDays: config.retentionDays,
      status: 'active',
      region,
      verifiedAt: null,
      identitySecret: newIdentitySecret(),
      keys: [newKey(at)],
      createdAt: at,
      updatedAt: at,
    };
    await kvSync.activateFirst(site);
    try {
      await store.insertSite(site);
    } catch (error) {
      await deleteKeys(s.kv, site.keys.map((k) => k.publicKey));
      if (error instanceof DuplicateError && error.field === 'domain') throw domainTaken(domain);
      throw error;
    }
    return site;
  };

  app.get('/sites/:id', async (c) => {
    const site = await sites.load(c);
    const view = siteView(site);
    return c.json({ site: view, snippets: view.publicKey ? snippetsFor(config.collectorUrl, view.publicKey) : [] });
  });

  app.patch('/sites/:id', async (c) => {
    const site = await sites.load(c);
    const patch = await sitePatchFrom(c, await body(c));

    /** One activity line per thing that really changed. */
    const log = async (updated: SiteDoc) => {
      if (patch.timezone && patch.timezone !== site.timezone) {
        await audit.record(c, 'site.timezone_changed', updated, `Changed the timezone of ${site.domain} from ${site.timezone} to ${patch.timezone}`);
      }
      if (patch.retentionDays && patch.retentionDays !== site.retentionDays) {
        const shorter = patch.retentionDays < site.retentionDays;
        await audit.record(
          c,
          'site.retention_changed',
          updated,
          `Changed how long ${site.domain} keeps data from ${site.retentionDays} to ${patch.retentionDays} days${shorter ? ' (older data is deleted within a week)' : ''}`,
        );
      }
      if (patch.status && patch.status !== site.status) {
        await audit.record(c, patch.status === 'paused' ? 'site.paused' : 'site.resumed', updated, `${patch.status === 'paused' ? 'Paused' : 'Resumed'} tracking on ${site.domain}`);
      }
    };

    if (patch.status === 'active' && site.status !== 'active') {
      // Resume = grant: the collector must accept the key again before the dashboard says so.
      await kvSync.activateFirst({ ...site, ...patch } as SiteDoc);
      const updated = await sites.patch(c, site, patch).catch(async (error) => {
        await kvSync.rollbackGrant(site, []);
        throw error;
      });
      await log(updated);
      return c.json({ site: siteView(updated), sync: { ok: true } });
    }
    const updated = await sites.patch(c, site, patch);
    const synced = patch.status ? await kvSync.sync(updated) : { ok: true };
    await log(updated);
    return c.json({ site: siteView(updated), sync: synced });
  });

  /** The fields PATCH /sites/:id accepts, checked. Retention needs the owner or an admin role. */
  const sitePatchFrom = async (c: Ctx, b: Record<string, unknown>): Promise<SitePatch> => {
    const patch: SitePatch = {};
    if (b.timezone !== undefined) {
      const tz = canonicalTimezone(str(b.timezone));
      if (!tz) throw invalidTimezone();
      patch.timezone = tz;
    }
    if (b.status !== undefined) {
      if (b.status !== 'active' && b.status !== 'paused') throw new HttpError(400, 'invalid_status', 'Status is active or paused.');
      patch.status = b.status;
    }
    if (b.retentionDays !== undefined) {
      // Shortening retention deletes data: owners and admins only (viewers come with invites).
      const role = await sites.roleOf(c);
      if (role !== 'owner' && role !== 'admin') throw new HttpError(403, 'not_allowed', 'Only the owner or an admin can change how long data is kept.');
      const days = Number(b.retentionDays);
      const allowed = RETENTION_CHOICES.filter((d) => d <= config.retentionDays) as number[];
      if (!allowed.includes(days)) throw new HttpError(400, 'invalid_retention', `Keep data for ${allowed.join(', ')} days.`);
      patch.retentionDays = days;
    }
    return patch;
  };

  app.delete('/sites/:id', async (c) => {
    const site = await sites.load(c);
    const updated = await sites.patch(c, site, { status: 'deleted', keys: revokeAll(site.keys, now()) });
    // Collected data is not deleted here (the dashboard says so): it follows the site's retention, and
    // re-adding the domain brings it back. Deleting the ACCOUNT erases it (POST /account/delete).
    const synced = await kvSync.sync(updated);
    await audit.record(c, 'site.deleted', updated, `Deleted ${site.domain} (tracking stopped; collected data is kept for ${site.retentionDays} days)`);
    return c.json({ ok: true, sync: synced });
  });

  app.post('/sites/:id/sync', async (c) => {
    const site = await sites.load(c);
    return c.json({ sync: await kvSync.sync(site) });
  });

  /** Passive check + the "waiting for your first pageview" poll (BUILD-ORDER ④/⑤). */
  app.get('/sites/:id/status', async (c) => {
    let site = await sites.load(c);
    let activity;
    try {
      activity = await deps.analytics.recent(site._id, PASSIVE_WINDOW_MINUTES);
    } catch (error) {
      logError('analytics_failed', { message: errorText(error) });
      throw analyticsUnavailable();
    }
    if (activity.pageviews > 0 && !site.verifiedAt) {
      site = (await store.updateSite(c.get('tenant')._id, site._id, site.updatedAt, { verifiedAt: now() }, now())) ?? site;
    }
    return c.json({ windowMinutes: PASSIVE_WINDOW_MINUTES, verifiedAt: site.verifiedAt?.toISOString() ?? null, ...activity });
  });

  /** Active check: fetch the customer's page and say exactly what is wrong. */
  app.post('/sites/:id/verify', async (c) => {
    const site = await sites.load(c);
    if (!limits.verify.take(`t:${c.get('tenant')._id.toHexString()}`, Date.now()) || !limits.verifyIp.take(`ip:${clientIp(c)}`, Date.now())) {
      throw new HttpError(429, 'rate_limited', 'Too many checks. Wait a few minutes and try again.');
    }
    const b = await body(c);
    try {
      return c.json(await runActiveCheck(site, str(b.url) || undefined, { allowPrivate: config.verifierAllowPrivate, ...deps.verifier }));
    } catch (error) {
      if (error instanceof VerifyInputError) throw new HttpError(400, 'invalid_url', error.message);
      throw error;
    }
  });

  /** "Allow" on a hostname drop: that host is added to the site's accepted hosts (KV synced). */
  app.post('/sites/:id/allowed-hosts', async (c) => {
    const site = await sites.load(c);
    const b = await body(c);
    const host = str(b.host).trim().toLowerCase().replace(/\.$/, '');
    if (!/^(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host) || host.length > 253) {
      throw new HttpError(400, 'invalid_host', 'Enter a host name like shop.example.com.');
    }
    if (site.allowedHosts.includes(host)) return c.json({ site: siteView(site), sync: { ok: true } });
    if (site.allowedHosts.length >= MAX_ALLOWED_HOSTS) throw new HttpError(409, 'too_many_hosts', `A site can accept at most ${MAX_ALLOWED_HOSTS} hosts.`);
    const next: SiteDoc = { ...site, allowedHosts: [...site.allowedHosts, host] };
    await kvSync.activateFirst(next);
    const updated = await sites.patch(c, site, { allowedHosts: next.allowedHosts }).catch(async (error) => {
      await kvSync.rollbackGrant(site, []);
      throw error;
    });
    await audit.record(c, 'host.allowed', updated, `Allowed ${host} to send data for ${site.domain}`);
    return c.json({ site: siteView(updated), sync: { ok: true } });
  });
}
