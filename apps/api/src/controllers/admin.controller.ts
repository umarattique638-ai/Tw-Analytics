import { actorOf, attachment, body } from '../http/request';
import type { Ctx } from '../http/types';
import type { Services } from '../services';
import { accountsQueryInput, confirmInput, tenantIdParam } from '../validators/admin.validator';
import { siteIdParam } from '../validators/site.validator';
import { rangeKeyInput } from '../validators/stats.validator';
import { adminAccountRow, adminAccountView } from '../views/admin';

/** Super admin (/admin): every account, and deleting accounts and sites, downloading reports. */
export function createAdminController({ admin }: Services) {
  return {
    async overview(c: Ctx) {
      return c.json(await admin.overview());
    },

    /** ?q= finds an e-mail, a name or a domain. */
    async accounts(c: Ctx) {
      const list = await admin.accounts(accountsQueryInput(c.req.query('q')));
      return c.json({ accounts: list.map(adminAccountRow) });
    },

    async account(c: Ctx) {
      return c.json({ account: adminAccountView(await admin.account(tenantIdParam(c.req.param('tenantId')))) });
    },

    /** Delete someone's account: typed confirmation, as in Settings. */
    async deleteAccount(c: Ctx) {
      const tenantId = tenantIdParam(c.req.param('tenantId'));
      confirmInput(await body(c));
      return c.json({ ok: true, erasure: await admin.deleteAccount(actorOf(c), tenantId) });
    },

    /** Delete a site, keeping its data (default) or erasing it (`eraseData: true`). */
    async deleteSite(c: Ctx) {
      const siteId = siteIdParam(c.req.param('siteId'));
      const b = await body(c);
      return c.json({ ok: true, ...(await admin.deleteSite(siteId, b.eraseData === true)) });
    },

    /** A site's CSV report for ?range= (7d by default), downloaded at once (not saved). */
    async report(c: Ctx) {
      const siteId = siteIdParam(c.req.param('siteId'));
      const out = await admin.report(siteId, rangeKeyInput(c.req.query('range'), '7d'));
      attachment(c, 'text/csv; charset=utf-8', out.filename);
      return c.body(out.csv);
    },
  };
}
export type AdminController = ReturnType<typeof createAdminController>;
