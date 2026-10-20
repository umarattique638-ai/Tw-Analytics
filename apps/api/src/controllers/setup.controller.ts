import { actorOf, body, clientIp, str } from '../http/request';
import type { Ctx } from '../http/types';
import type { Services } from '../services';
import { setupInput } from '../validators/site.validator';
import { setupView, siteView } from '../views/json';

/** Adding a site (decision 25): services/setup.service.ts. */
export function createSetupController({ setup, config }: Services) {
  return {
    /** The setup in progress and its snippet. */
    async current(c: Ctx) {
      const current = await setup.current(actorOf(c));
      return c.json({ setup: current ? setupView(current, config.collectorUrl) : null });
    },

    /** Start: domain + timezone -> key + snippet. The same domain again resumes (200), a new one starts (201). */
    async start(c: Ctx) {
      const input = setupInput(await body(c));
      const { setup: started, resumed } = await setup.start(actorOf(c), input, clientIp(c));
      if (resumed) return c.json({ setup: setupView(started, config.collectorUrl), resumed: true });
      return c.json({ setup: setupView(started, config.collectorUrl) }, 201);
    },

    /** Cancel: the key stops working, nothing is left. */
    async cancel(c: Ctx) {
      await setup.cancel(actorOf(c));
      return c.json({ ok: true });
    },

    /** Run the install check; when every step passes, the site is created (verified). */
    async verify(c: Ctx) {
      const url = str((await body(c)).url) || undefined;
      const { result, site } = await setup.verify(actorOf(c), url, clientIp(c));
      return c.json({ ...result, verifiedAt: site?.verifiedAt?.toISOString() ?? null, site: site ? siteView(site) : null });
    },
  };
}
export type SetupController = ReturnType<typeof createSetupController>;
