import { ObjectId } from 'mongodb';
import { EXPORT_KEEP_DAYS, EXPORT_MAX } from '../constants';
import { HttpError } from '../http/errors';
import { attachment, body, str } from '../http/request';
import type { Api, Ctx } from '../http/types';
import type { Services } from '../services';
import { parseRangeKey } from '../services/reports';
import { resolveRange } from '../stats';
import type { ExportDoc } from '../store/types';
import { exportView } from '../views';

/** `:exportId` of the URL; anything that is not an id is simply "no such report". */
const exportId = (c: Ctx) => {
  const raw = c.req.param('exportId') ?? '';
  if (!/^[0-9a-f]{24}$/.test(raw)) throw new HttpError(404, 'not_found', 'No such report.');
  return new ObjectId(raw);
};

/** Reports: saved CSV exports, kept EXPORT_KEEP_DAYS days. */
export function reportRoutes(app: Api, { store, sites, reports, audit, now }: Services) {
  app.get('/sites/:id/exports', async (c) => {
    const site = await sites.load(c);
    const list = await store.exportsOf(c.get('tenant')._id, site._id, now(), EXPORT_MAX);
    return c.json({ keepDays: EXPORT_KEEP_DAYS, max: EXPORT_MAX, exports: list.map(exportView) });
  });

  /** Make a report: the CSV is built now, saved, and can be downloaded again until it expires. */
  app.post('/sites/:id/exports', async (c) => {
    const site = await sites.load(c);
    const key = parseRangeKey(str((await body(c)).range));
    const tenantId = c.get('tenant')._id;
    const at = now();
    if ((await store.countExports(tenantId, site._id, at)) >= EXPORT_MAX) {
      throw new HttpError(409, 'too_many_reports', `You have ${EXPORT_MAX} saved reports for this site. Delete some to make a new one.`);
    }
    const range = resolveRange(key, site.timezone, at);
    const out = await reports.buildCsv(site, range);
    const doc: ExportDoc = {
      _id: new ObjectId(),
      tenantId,
      siteId: site._id,
      range: key,
      from: range.from,
      to: range.to,
      timezone: site.timezone,
      filename: out.filename,
      rows: out.rows,
      bytes: Buffer.byteLength(out.csv, 'utf8'),
      csv: out.csv,
      createdBy: c.get('user')._id,
      createdAt: at,
      expiresAt: new Date(at.getTime() + EXPORT_KEEP_DAYS * 86_400_000),
    };
    await store.insertExport(doc);
    await audit.record(c, 'report.created', site, `Made a report of ${site.domain}: ${range.from === range.to ? range.from : `${range.from} to ${range.to}`}`);
    return c.json({ export: exportView(doc) }, 201);
  });

  app.get('/sites/:id/exports/:exportId/download', async (c) => {
    const site = await sites.load(c);
    const e = await store.exportById(c.get('tenant')._id, site._id, exportId(c), now());
    if (!e) throw new HttpError(404, 'not_found', 'This report no longer exists (deleted, or older than 90 days).');
    attachment(c, 'text/csv; charset=utf-8', e.filename);
    return c.body(e.csv);
  });

  app.delete('/sites/:id/exports/:exportId', async (c) => {
    const site = await sites.load(c);
    const id = exportId(c);
    const report = await store.exportById(c.get('tenant')._id, site._id, id, now()).catch(() => null); // only for the log line
    const gone = await store.deleteExport(c.get('tenant')._id, site._id, id);
    if (!gone) throw new HttpError(404, 'not_found', 'No such report.');
    await audit.record(c, 'report.deleted', site, `Deleted the report ${report?.filename ?? id.toHexString()}`);
    return c.json({ ok: true });
  });
}
