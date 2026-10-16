import { HttpError } from '../http/errors';
import type { Ctx } from '../http/types';
import type { ControlStore, MembershipDoc, SiteDoc, SitePatch } from '../models/types';

/** Reading and changing one of the signed-in workspace's sites. */
export function createSiteService(store: ControlStore, now: () => Date) {
  return {
    /** The site of `:id` in the URL, if it belongs to this workspace; 404 otherwise (never "forbidden"). */
    async load(c: Ctx): Promise<SiteDoc> {
      const id = Number(c.req.param('id'));
      if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(404, 'not_found', 'No such site.');
      const site = await store.site(c.get('tenant')._id, id);
      if (!site) throw new HttpError(404, 'not_found', 'No such site.');
      return site;
    },

    /** Saves a change, unless the site changed since it was loaded (another tab): then 409. */
    async patch(c: Ctx, site: SiteDoc, patch: SitePatch): Promise<SiteDoc> {
      const updated = await store.updateSite(c.get('tenant')._id, site._id, site.updatedAt, patch, now());
      if (!updated) throw new HttpError(409, 'conflict', 'This site changed in another tab. Reload and try again.');
      return updated;
    },

    /** The signed-in user's role in the signed-in workspace. */
    async roleOf(c: Ctx): Promise<MembershipDoc['role'] | undefined> {
      const tenantId = c.get('tenant')._id;
      return (await store.membershipsOf(c.get('user')._id)).find((m) => m.tenantId.equals(tenantId))?.role;
    },
  };
}
export type SiteService = ReturnType<typeof createSiteService>;
