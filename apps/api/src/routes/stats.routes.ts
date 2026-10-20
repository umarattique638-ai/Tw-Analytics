import type { StatsController } from '../controllers/stats.controller';
import type { Api } from '../http/types';

/** The numbers behind the dashboard pages. Signed in. */
export function statsRoutes(app: Api, c: StatsController) {
  app.get('/sites/:id/stats/overview', c.overview);
  app.get('/sites/:id/stats/filter-values', c.filterValues);
  app.get('/sites/:id/stats/live', c.live);
  app.get('/sites/:id/stats/events', c.events);
  app.get('/sites/:id/stats/drops', c.drops);
  app.get('/sites/:id/export.csv', c.csv);
}
