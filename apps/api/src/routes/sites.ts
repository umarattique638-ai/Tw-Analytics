import { RETENTION_CHOICES } from '../config';
import { MAX_ALLOWED_HOSTS } from '../constants';
import { allowedHostsFor, canonicalTimezone, normalizeDomain } from '../domain';
import { ObjectId } from 'mongodb';
import { HttpError, errorText, logError } from '../http/errors';
import { advanceErasure } from '../jobs';
import { body, str } from '../http/request';
import type { Api, Ctx } from '../http/types';
import type { Services } from '../services';
import { snippetsFor } from '../snippets';
import type { KeyDoc, SiteDoc, SitePatch } from '../store/types';
import { siteView } from '../views';

const invalidDomain = () => new HttpError(400, 'invalid_domain', 'Enter a domain like example.com (no IP addresses or localhost).');
const invalidTimezone = () => new HttpError(400, 'invalid_timezone', 'Choose a timezone from the list.');
const revokeAll = (keys: KeyDoc[], at: Date) => keys.map((k) => ({ ...k, status: 'revoked' as const, revokedAt: k.revokedAt ?? at }));

/**
 * The workspace's sites: list, change, delete. Every stored site is verified: adding one is routes/setup.ts,
 * which saves it only after every install check passed (decision 25).
 */
export function siteRoutes(app: Api, s: Services) {
  const { store, config, sites, kvSync, audit, now } = s;

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

  /**
   * Delete a site. Two choices (the dialog asks):
   *   keep data (default): tracking stops, the site leaves the account, collected data follows the site's
   *     retention, and adding the domain again brings it back.
   *   eraseData: true: the site AND everything collected for it are deleted now, for good. Owners and
   *     admins only. It becomes an erasure record (like a deleted account): KV keys go and the ClickHouse
   *     deletes are sent right away; the nightly job repeats both until nothing is left, then watches for
   *     late rows (queue retries) for a while.
   */
  app.delete('/sites/:id', async (c) => {
    const site = await sites.load(c);
    const b = await body(c);
    if (b.eraseData === true) return eraseSite(c, site);
    const updated = await sites.patch(c, site, { status: 'deleted', keys: revokeAll(site.keys, now()) });
    const synced = await kvSync.sync(updated);
    await audit.record(c, 'site.deleted', updated, `Deleted ${site.domain} (tracking stopped; collected data is kept for ${site.retentionDays} days)`);
    return c.json({ ok: true, sync: synced, erased: false });
  });

  const eraseSite = async (c: Ctx, site: SiteDoc) => {
    const role = await sites.roleOf(c);
    if (role !== 'owner' && role !== 'admin') throw new HttpError(403, 'not_allowed', 'Only the owner or an admin can delete collected data.');
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
      c.get('tenant')._id,
      site._id,
    );
    if (!erasure) throw new HttpError(404, 'not_found', 'No such site.');
    // First step now (keys removed, ClickHouse deletes sent); the nightly job finishes and checks it.
    const progress = await advanceErasure({ store, kv: s.kv, eraser: s.eraser, mailer: s.mailer }, erasure, at, { finish: false, dataBudgetMs: 20_000, deleteFirst: true }).catch((error) => {
      logError('site_erase_start_failed', { site: site._id, message: errorText(error) });
      return erasure;
    });
    await audit.record(c, 'site.deleted', site, `Deleted ${site.domain} and all its collected data (erased for good; it cannot be brought back)`);
    return c.json({ ok: true, sync: { ok: !!progress.kvDoneAt }, erased: true });
  };

  app.post('/sites/:id/sync', async (c) => {
    const site = await sites.load(c);
    return c.json({ sync: await kvSync.sync(site) });
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
