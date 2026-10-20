import { ObjectId } from 'mongodb';
import { HttpError } from '../http/errors';
import { str } from '../http/request';
import { DELETE_CONFIRMATION } from '../lib/constants';

/** Request checks of the account and its activity log. Each throws the error the client sees. */

/** Deleting the account: the typed confirmation first (the password is checked by the service, rate-limited). */
export function deleteAccountInput(b: Record<string, unknown>): { password: string } {
  if (str(b.confirm) !== DELETE_CONFIRMATION) throw new HttpError(400, 'confirm_required', `Type ${DELETE_CONFIRMATION} to confirm.`);
  return { password: str(b.password) };
}

export interface AuditQuery {
  limit: number;
  siteId?: number;
  before?: { at: Date; id: ObjectId };
}

/** Cursor of the activity log: "<ms>.<id>" of the last entry shown (views/json auditCursor). */
export function auditCursorInput(raw: string | undefined): { at: Date; id: ObjectId } | undefined {
  const m = /^(\d{1,15})\.([0-9a-f]{24})$/.exec(raw ?? '');
  return m ? { at: new Date(Number(m[1])), id: new ObjectId(m[2]) } : undefined;
}

/** GET /audit: 50 at a time (1-100), optionally one site, continuing after `before`. */
export function auditQueryInput(query: (key: string) => string | undefined): AuditQuery {
  const limit = Math.min(100, Math.max(1, Number(query('limit') ?? 50) || 50));
  const siteRaw = query('site');
  const siteId = siteRaw ? Number(siteRaw) : undefined;
  if (siteId !== undefined && (!Number.isSafeInteger(siteId) || siteId < 1)) throw new HttpError(400, 'invalid_site', 'site is a site id.');
  return { limit, siteId, before: auditCursorInput(query('before')) };
}
