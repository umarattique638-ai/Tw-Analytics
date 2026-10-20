import { AUDIT_KEEP_DAYS } from '../lib/constants';
import { actorOf } from '../http/request';
import type { Ctx } from '../http/types';
import type { Services } from '../services';
import { auditQueryInput } from '../validators/account.validator';
import { auditCursor, auditView } from '../views/json';

/** Phase 3 activity log: newest first, 50 at a time; `before` continues from the last entry shown, `site` filters. */
export function createAuditController({ audit }: Services) {
  return {
    async list(c: Ctx) {
      const actor = actorOf(c);
      const q = auditQueryInput((k) => c.req.query(k));
      const { page, more, domains } = await audit.list(actor, q);
      return c.json({
        keepDays: AUDIT_KEEP_DAYS,
        entries: page.map((e) => auditView(e, actor.user._id, domains)),
        next: more ? auditCursor(page[page.length - 1]!) : null,
      });
    },
  };
}
export type AuditController = ReturnType<typeof createAuditController>;
