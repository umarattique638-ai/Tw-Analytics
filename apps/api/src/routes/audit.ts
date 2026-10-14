import { AUDIT_KEEP_DAYS } from '../constants';
import { HttpError } from '../http/errors';
import type { Api } from '../http/types';
import type { Services } from '../services';
import { auditCursor, auditView, parseAuditCursor } from '../views';

/** Phase 3 activity log: newest first, 50 at a time; `before` continues from the last entry shown, `site` filters. */
export function auditRoutes(app: Api, { store }: Services) {
  app.get('/audit', async (c) => {
    const tenantId = c.get('tenant')._id;
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 50) || 50));
    const siteRaw = c.req.query('site');
    const siteId = siteRaw ? Number(siteRaw) : undefined;
    if (siteId !== undefined && (!Number.isSafeInteger(siteId) || siteId < 1)) throw new HttpError(400, 'invalid_site', 'site is a site id.');
    const entries = await store.auditOf(tenantId, { limit: limit + 1, siteId, before: parseAuditCursor(c.req.query('before')) });
    const page = entries.slice(0, limit);
    const domains = new Map((await store.sitesOf(tenantId, true)).map((s) => [s._id, s.domain]));
    const me = c.get('user')._id;
    return c.json({
      keepDays: AUDIT_KEEP_DAYS,
      entries: page.map((e) => auditView(e, me, domains)),
      next: entries.length > limit ? auditCursor(page[page.length - 1]!) : null,
    });
  });
}
