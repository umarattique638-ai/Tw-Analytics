import { attachment } from '../http/request';
import type { Api, Ctx } from '../http/types';
import { FILTER_KEYS } from '../repositories/stats';
import type { FilterKey, Filters } from '../repositories/stats';
import { HttpError } from '../http/errors';
import type { Services } from '../services';

/** Overview filters from the query string (?page=/pricing&country=PK): plain values, length-capped. */
const filtersOf = (c: Ctx): Filters => {
  const out: Filters = {};
  for (const k of FILTER_KEYS) {
    const v = c.req.query(k);
    if (typeof v === 'string' && v.trim() && v.length <= 500) out[k] = v;
  }
  return out;
};

/** Stage 6 Query API: the numbers behind the dashboard pages (docs/QUERIES.md). */
export function statsController(app: Api, { sites, reports, now }: Services) {
  const { reader, reading, rangeOf, buildCsv } = reports;

  app.get('/sites/:id/stats/overview', async (c) => {
    const site = await sites.load(c);
    const range = rangeOf(c, site);
    return c.json(await reading(() => reader().overview(site._id, range, filtersOf(c))));
  });

  /** The Filter menu (decision 30): ?key=page|country|source|device|browser&q=search. */
  app.get('/sites/:id/stats/filter-values', async (c) => {
    const site = await sites.load(c);
    const range = rangeOf(c, site);
    const key = c.req.query('key') as FilterKey;
    if (!FILTER_KEYS.includes(key)) throw new HttpError(400, 'invalid_filter', 'Unknown filter.');
    const q = (c.req.query('q') ?? '').trim().slice(0, 100);
    return c.json({ values: await reading(() => reader().filterValues(site._id, range, key, q)) });
  });

  app.get('/sites/:id/stats/live', async (c) => {
    const site = await sites.load(c);
    return c.json(await reading(() => reader().live(site._id, now())));
  });

  app.get('/sites/:id/stats/events', async (c) => {
    const site = await sites.load(c);
    const range = rangeOf(c, site);
    return c.json(await reading(() => reader().events(site._id, range, now())));
  });

  app.get('/sites/:id/stats/drops', async (c) => {
    const site = await sites.load(c);
    const range = rangeOf(c, site);
    return c.json(await reading(() => reader().drops(site._id, range)));
  });

  /** Direct download, not saved (API clients). The dashboard saves every export as a report (controllers/reports.ts). */
  app.get('/sites/:id/export.csv', async (c) => {
    const site = await sites.load(c);
    const out = await buildCsv(site, rangeOf(c, site));
    attachment(c, 'text/csv; charset=utf-8', out.filename);
    return c.body(out.csv);
  });
}
