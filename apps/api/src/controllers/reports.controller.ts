import { EXPORT_KEEP_DAYS, EXPORT_MAX } from '../lib/constants';
import { actorOf, attachment, body, str } from '../http/request';
import type { Ctx } from '../http/types';
import type { Services } from '../services';
import { siteIdParam } from '../validators/site.validator';
import { exportIdParam, rangeKeyInput } from '../validators/stats.validator';
import { exportView } from '../views/json';

/** Reports: saved CSV exports, kept EXPORT_KEEP_DAYS days (services/reports.service.ts). */
export function createReportsController({ sites, reports }: Services) {
  const siteOf = (c: Ctx) => sites.load(actorOf(c), siteIdParam(c.req.param('id')));

  return {
    async list(c: Ctx) {
      const site = await siteOf(c);
      const list = await reports.list(actorOf(c), site);
      return c.json({ keepDays: EXPORT_KEEP_DAYS, max: EXPORT_MAX, exports: list.map(exportView) });
    },

    /** Make a report: the CSV is built now, saved, and can be downloaded again until it expires. */
    async create(c: Ctx) {
      const site = await siteOf(c);
      const key = rangeKeyInput(str((await body(c)).range));
      const doc = await reports.create(actorOf(c), site, key);
      return c.json({ export: exportView(doc) }, 201);
    },

    async download(c: Ctx) {
      const site = await siteOf(c);
      const e = await reports.download(actorOf(c), site, exportIdParam(c.req.param('exportId')));
      attachment(c, 'text/csv; charset=utf-8', e.filename);
      return c.body(e.csv);
    },

    async remove(c: Ctx) {
      const site = await siteOf(c);
      await reports.remove(actorOf(c), site, exportIdParam(c.req.param('exportId')));
      return c.json({ ok: true });
    },
  };
}
export type ReportsController = ReturnType<typeof createReportsController>;
