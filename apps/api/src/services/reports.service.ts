import { ObjectId } from 'mongodb';
import { EXPORT_KEEP_DAYS, EXPORT_MAX } from '../lib/constants';
import { HttpError } from '../http/errors';
import { resolveRange } from '../repositories/stats';
import type { RangeKey } from '../repositories/stats';
import type { ExportDoc } from '../models/export.model';
import type { SiteDoc } from '../models/site.model';
import type { Actor, Services } from './types';

/** Reports: saved CSV exports of a site, kept EXPORT_KEEP_DAYS days, at most EXPORT_MAX at a time. */
export function createReportsService(s: Services) {
  const { store, stats, audit, now } = s;

  return {
    /** The site's saved reports, newest first (without their CSV). */
    list: (actor: Actor, site: SiteDoc) => store.exportsOf(actor.tenant._id, site._id, now(), EXPORT_MAX),

    /** Make a report: the CSV is built now, saved, and can be downloaded again until it expires. */
    async create(actor: Actor, site: SiteDoc, key: RangeKey): Promise<ExportDoc> {
      const tenantId = actor.tenant._id;
      const at = now();
      if ((await store.countExports(tenantId, site._id, at)) >= EXPORT_MAX) {
        throw new HttpError(409, 'too_many_reports', `You have ${EXPORT_MAX} saved reports for this site. Delete some to make a new one.`);
      }
      const range = resolveRange(key, site.timezone, at);
      const out = await stats.buildCsv(site, range);
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
        createdBy: actor.user._id,
        createdAt: at,
        expiresAt: new Date(at.getTime() + EXPORT_KEEP_DAYS * 86_400_000),
      };
      await store.insertExport(doc);
      await audit.record(actor, 'report.created', site, `Made a report of ${site.domain}: ${range.from === range.to ? range.from : `${range.from} to ${range.to}`}`);
      return doc;
    },

    /** A saved report with its CSV, while it exists. */
    async download(actor: Actor, site: SiteDoc, id: ObjectId): Promise<ExportDoc> {
      const e = await store.exportById(actor.tenant._id, site._id, id, now());
      if (!e) throw new HttpError(404, 'not_found', 'This report no longer exists (deleted, or older than 90 days).');
      return e;
    },

    async remove(actor: Actor, site: SiteDoc, id: ObjectId): Promise<void> {
      const report = await store.exportById(actor.tenant._id, site._id, id, now()).catch(() => null); // only for the log line
      const gone = await store.deleteExport(actor.tenant._id, site._id, id);
      if (!gone) throw new HttpError(404, 'not_found', 'No such report.');
      await audit.record(actor, 'report.deleted', site, `Deleted the report ${report?.filename ?? id.toHexString()}`);
    },
  };
}
export type ReportsService = ReturnType<typeof createReportsService>;
