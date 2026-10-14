import { attachment } from '../http/request';
import type { Api } from '../http/types';
import type { Services } from '../services';

/** Stage 6 Query API: the numbers behind the dashboard pages (docs/QUERIES.md). */
export function statsRoutes(app: Api, { sites, reports, now }: Services) {
  const { reader, reading, rangeOf, buildCsv } = reports;

  app.get('/sites/:id/stats/overview', async (c) => {
    const site = await sites.load(c);
    const range = rangeOf(c, site);
    return c.json(await reading(() => reader().overview(site._id, range)));
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

  /** Direct download, not saved (API clients). The dashboard saves every export as a report (routes/reports.ts). */
  app.get('/sites/:id/export.csv', async (c) => {
    const site = await sites.load(c);
    const out = await buildCsv(site, rangeOf(c, site));
    attachment(c, 'text/csv; charset=utf-8', out.filename);
    return c.body(out.csv);
  });
}
