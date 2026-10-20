import { actorOf, body } from '../http/request';
import type { Ctx } from '../http/types';
import type { Services } from '../services';
import { domainInput, siteIdParam, sitePatchInput } from '../validators/site.validator';
import { kvIssueView, siteView } from '../views/json';
import { healthView } from '../views/site-health';
import { snippetsFor } from '../views/snippets';

/**
 * The workspace's sites: list, change, delete, health, domain. Every stored site is verified: adding one is
 * the setup controller (decision 25).
 */
export function createSitesController({ sites, config }: Services) {
  /** The site of `:id` in the URL, if it belongs to the signed-in workspace (404 otherwise). */
  const siteOf = (c: Ctx) => sites.load(actorOf(c), siteIdParam(c.req.param('id')));

  return {
    async list(c: Ctx) {
      const out = await sites.list(actorOf(c));
      return c.json({
        sites: out.sites.map(({ site, health }) => ({ ...siteView(site), health: healthView(site, health).status })),
        kvIssues: out.issues.map(({ issue, site }) => kvIssueView(issue, site)),
      });
    },

    /** Is this site still sending data (decision 28)? */
    async health(c: Ctx) {
      const site = await siteOf(c);
      return c.json({ health: healthView(site, await sites.health(actorOf(c), site)) });
    },

    /** "Check again" on the banner. */
    async checkHealth(c: Ctx) {
      const site = await siteOf(c);
      return c.json({ health: healthView(site, await sites.checkHealth(actorOf(c), site)) });
    },

    /** "Retry now" on the dashboard's Cloudflare warning. */
    async syncAll(c: Ctx) {
      const issues = await sites.syncAll(actorOf(c));
      return c.json({ kvIssues: issues.map(({ issue, site }) => kvIssueView(issue, site)) });
    },

    /** What adding this domain would register: the form shows it before submit. */
    preview(c: Ctx) {
      return c.json(sites.preview(domainInput(c.req.query('domain') ?? '')));
    },

    async get(c: Ctx) {
      const site = await siteOf(c);
      const view = siteView(site);
      return c.json({ site: view, snippets: view.publicKey ? snippetsFor(config.collectorUrl, view.publicKey) : [] });
    },

    /** Timezone, retention, pause / resume. */
    async update(c: Ctx) {
      const site = await siteOf(c);
      const input = sitePatchInput(await body(c));
      const out = await sites.update(actorOf(c), site, input);
      return c.json({ site: siteView(out.site), sync: out.sync });
    },

    /** Delete a site, keeping its data (default) or erasing it (`eraseData: true`). */
    async remove(c: Ctx) {
      const site = await siteOf(c);
      const b = await body(c);
      const out = await sites.remove(actorOf(c), site, b.eraseData === true);
      return c.json({ ok: true, ...out });
    },

    async sync(c: Ctx) {
      const site = await siteOf(c);
      return c.json({ sync: await sites.sync(site) });
    },

    /** Decision 29: the site moved to a new domain. */
    async changeDomain(c: Ctx) {
      const site = await siteOf(c);
      const b = await body(c);
      const out = await sites.changeDomain(actorOf(c), site, b.domain);
      return c.json({ ...out.result, site: out.site ? siteView(out.site) : null });
    },

    /** Adds a host to the site's accepted hosts (API only). */
    async allowHost(c: Ctx) {
      const site = await siteOf(c);
      const b = await body(c);
      const out = await sites.allowHost(actorOf(c), site, b.host);
      return c.json({ site: siteView(out.site), sync: out.sync });
    },
  };
}
export type SitesController = ReturnType<typeof createSitesController>;
