import { gzipSync } from 'node:zlib';
import { clearSessionCookie } from '../http/cookies';
import { actorOf, body } from '../http/request';
import type { Ctx } from '../http/types';
import type { Services } from '../services';
import { deleteAccountInput } from '../validators/account.validator';
import { tenantView, userView } from '../views/json';

/** The signed-in user and workspace: who am I, download everything, delete everything. */
export function createAccountController({ account, config }: Services) {
  return {
    async me(c: Ctx) {
      const actor = actorOf(c);
      const { role, retention } = await account.profile(actor);
      return c.json({ user: userView(actor.user), tenant: tenantView(actor.tenant), role, retention });
    },

    /**
     * "Download your data": one JSON file. Sent gzip-compressed when the browser accepts it (every browser
     * does): a big account stays far below Vercel's response size limit.
     */
    async exportAll(c: Ctx) {
      const { json, filename } = await account.exportAll(actorOf(c));
      c.header('content-type', 'application/json; charset=utf-8');
      c.header('content-disposition', `attachment; filename="${filename}"`);
      if (/\bgzip\b/.test(c.req.header('accept-encoding') ?? '')) {
        c.header('content-encoding', 'gzip');
        c.header('vary', 'accept-encoding');
        return c.body(new Uint8Array(gzipSync(json)));
      }
      return c.body(json);
    },

    /** Delete the account (owner only, password + typed confirmation): services/account.service.ts. */
    async remove(c: Ctx) {
      const { password } = deleteAccountInput(await body(c));
      const erasure = await account.remove(actorOf(c), password);
      clearSessionCookie(c, config.secureCookies);
      return c.json({ ok: true, erasure });
    },
  };
}
export type AccountController = ReturnType<typeof createAccountController>;
