import { actorOf } from '../http/request';
import type { Ctx } from '../http/types';
import type { Services } from '../services';
import { siteIdParam } from '../validators/site.validator';
import { siteView } from '../views/json';

/** Site keys: rotation is "add a new key, swap the snippet, revoke the old one" (services/keys.service.ts). */
export function createKeysController({ sites, keys }: Services) {
  return {
    async create(c: Ctx) {
      const actor = actorOf(c);
      const site = await sites.load(actor, siteIdParam(c.req.param('id')));
      const updated = await keys.create(actor, site);
      return c.json({ site: siteView(updated), sync: { ok: true } }, 201);
    },

    async revoke(c: Ctx) {
      const actor = actorOf(c);
      const site = await sites.load(actor, siteIdParam(c.req.param('id')));
      const out = await keys.revoke(actor, site, c.req.param('keyId') ?? '');
      return c.json({ site: siteView(out.site), sync: out.sync });
    },
  };
}
export type KeysController = ReturnType<typeof createKeysController>;
