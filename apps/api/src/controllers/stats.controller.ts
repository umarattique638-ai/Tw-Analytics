import { actorOf, attachment } from '../http/request';
import type { Ctx } from '../http/types';
import type { Services } from '../services';
import { siteIdParam } from '../validators/site.validator';
import { filterValuesInput, filtersInput, rangeKeyInput } from '../validators/stats.validator';

/** Stage 6 Query API: the numbers behind the dashboard pages (docs/QUERIES.md). `?range=` defaults to 7d. */
export function createStatsController({ sites, stats }: Services) {
  const siteOf = (c: Ctx) => sites.load(actorOf(c), siteIdParam(c.req.param('id')));
  const rangeOf = (c: Ctx) => rangeKeyInput(c.req.query('range'), '7d');

  return {
    async overview(c: Ctx) {
      const site = await siteOf(c);
      const range = rangeOf(c);
      return c.json(await stats.overview(site, range, filtersInput((k) => c.req.query(k))));
    },

    /** The Filter menu (decision 30): ?key=page|country|source|device|browser&q=search. */
    async filterValues(c: Ctx) {
      const site = await siteOf(c);
      const range = rangeOf(c);
      const { key, q } = filterValuesInput(c.req.query('key'), c.req.query('q'));
      return c.json(await stats.filterValues(site, range, key, q));
    },

    async live(c: Ctx) {
      const site = await siteOf(c);
      return c.json(await stats.live(site));
    },

    async events(c: Ctx) {
      const site = await siteOf(c);
      return c.json(await stats.events(site, rangeOf(c)));
    },

    async drops(c: Ctx) {
      const site = await siteOf(c);
      return c.json(await stats.drops(site, rangeOf(c)));
    },

    /** Direct download, not saved (API clients). The dashboard saves every export as a report. */
    async csv(c: Ctx) {
      const site = await siteOf(c);
      const out = await stats.csv(site, rangeOf(c));
      attachment(c, 'text/csv; charset=utf-8', out.filename);
      return c.body(out.csv);
    },
  };
}
export type StatsController = ReturnType<typeof createStatsController>;
