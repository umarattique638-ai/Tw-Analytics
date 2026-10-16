import { ObjectId } from 'mongodb';
import { AUDIT_KEEP_DAYS } from '../lib/constants';
import { errorText, logError } from '../http/errors';
import type { Ctx } from '../http/types';
import type { AuditAction, ControlStore, SiteDoc, UserDoc } from '../models/types';

/**
 * Activity log (Phase 3). Written after the change succeeded; a failure to write it is logged and never
 * undoes or fails the change itself (the customer's action matters more than its log line).
 */
export function createAuditLog(store: ControlStore, now: () => Date) {
  const write = async (tenantId: ObjectId, actor: UserDoc | null, action: AuditAction, siteId: number | null, summary: string) => {
    const at = now();
    try {
      await store.insertAudit({
        _id: new ObjectId(),
        tenantId,
        at,
        actorKind: actor ? 'user' : 'system',
        actorId: actor?._id ?? null,
        actorName: (actor ? actor.name || actor.email : 'TailWatch').slice(0, 120),
        action,
        siteId,
        summary: summary.slice(0, 300),
        expiresAt: new Date(at.getTime() + AUDIT_KEEP_DAYS * 86_400_000),
      });
    } catch (error) {
      logError('audit_failed', { action, message: errorText(error) });
    }
  };

  return {
    /** Any actor; `null` is TailWatch itself (the nightly jobs). */
    write,
    /** The signed-in user did something (to a site, or to the account when site is null). */
    record: (c: Ctx, action: AuditAction, site: SiteDoc | null, summary: string) => write(c.get('tenant')._id, c.get('user'), action, site?._id ?? null, summary),
    /** For a user who is not signed in yet (login, password reset): finds the workspace, never throws. */
    async forUser(user: UserDoc, action: AuditAction, summary: string) {
      try {
        const tenantId = (await store.membershipsOf(user._id))[0]?.tenantId;
        if (tenantId) await write(tenantId, user, action, null, summary);
      } catch (error) {
        logError('audit_failed', { action, message: errorText(error) });
      }
    },
  };
}
export type AuditLog = ReturnType<typeof createAuditLog>;
