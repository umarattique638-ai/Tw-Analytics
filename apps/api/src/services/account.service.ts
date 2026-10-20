import { RETENTION_CHOICES } from '../config';
import { HttpError, errorText, logError, logInfo } from '../http/errors';
import { verifyPassword } from '../lib/passwords';
import { count } from '../lib/text';
import { localDate } from '../repositories/stats';
import type { ErasureDoc } from '../models/erasure.model';
import { accountDeletedMail } from '../views/emails';
import { buildAccountExport } from './account-export.service';
import { ERASURE_SETTLE_DAYS, advanceErasure } from './jobs.service';
import type { Actor, Services } from './types';

/** A fresh erasure record; the store fills in siteIds and publicKeys from what its transaction deletes. */
const newErasure = (tenantId: ErasureDoc['_id'], email: string, name: string | null, at: Date): Omit<ErasureDoc, 'siteIds' | 'publicKeys'> => ({
  _id: tenantId,
  email,
  name,
  requestedAt: at,
  status: 'pending',
  kvDoneAt: null,
  dataDeleteSentAt: null,
  dataVerifiedAt: null,
  rowsFound: null,
  rowsAfterCompletion: 0,
  attempts: 0,
  lastError: null,
  completedAt: null,
  updatedAt: at,
});

/** The signed-in user and workspace: who am I, download everything, delete everything. */
export function createAccountService(s: Services) {
  const { store, config, limits, mailer, sites, audit, now } = s;

  return {
    /** Who is signed in, their role, and the retention choices this server offers. */
    async profile(actor: Actor) {
      return {
        role: (await sites.roleOf(actor)) ?? 'viewer',
        retention: { choices: RETENTION_CHOICES.filter((d) => d <= config.retentionDays), max: config.retentionDays, default: config.retentionDays },
      };
    },

    /** "Download your data": one JSON file (services/account-export.service.ts). */
    async exportAll(actor: Actor): Promise<{ json: string; filename: string }> {
      const at = now();
      const { data, siteCount } = await buildAccountExport(s, actor.tenant, actor.user, at);
      const json = JSON.stringify(data);
      await audit.record(actor, 'account.exported', null, `Downloaded all account data (${count(siteCount, 'site')})`);
      return { json, filename: `tailwatch-export-${localDate(at, 'UTC')}.json` };
    },

    /**
     * Delete the account (owner only, password + typed confirmation). Everything in MongoDB goes at once, in
     * one transaction, and an erasure record remembers what is left: the sites' Cloudflare KV keys and their
     * ClickHouse rows. Both are started here (ClickHouse with a time limit: Vercel stops at 30 s); the
     * nightly job finishes, verifies after ERASURE_SETTLE_DAYS that nothing is left, e-mails the owner, and
     * keeps watching for ERASURE_WATCH_DAYS.
     */
    async remove(actor: Actor, password: string) {
      const { user, tenant } = actor;
      if (!limits.deleteAccount.take(`user:${user._id.toHexString()}`, Date.now())) {
        throw new HttpError(429, 'rate_limited', 'Too many attempts. Wait 15 minutes and try again.');
      }
      if (!user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
        throw new HttpError(401, 'invalid_password', 'Wrong password.');
      }
      const members = await store.membersOf(tenant._id);
      if (members.find((m) => m.userId.equals(user._id))?.role !== 'owner') {
        throw new HttpError(403, 'owner_only', 'Only the owner of this workspace can delete it.');
      }
      const at = now();
      const erasure = await store.eraseAccount(
        newErasure(tenant._id, user.email, user.name ?? null, at),
        members.map((m) => m.userId),
      );
      const siteCount = erasure.siteIds.length;
      logInfo('account_deleted', { erasure: tenant._id.toHexString(), sites: siteCount });

      // The e-mail first: it must not depend on how fast Cloudflare or ClickHouse answer.
      if (mailer.configured) {
        try {
          await mailer.send(accountDeletedMail(user.email, user.name ?? null, siteCount, ERASURE_SETTLE_DAYS));
        } catch (error) {
          logError('mail_failed', { kind: 'account_deleted', message: errorText(error) });
        }
      }
      // Then the first step of the erasure (best effort; the nightly job retries everything).
      const progress = await advanceErasure({ store, kv: s.kv, eraser: s.eraser, mailer }, erasure, at, { finish: false, dataBudgetMs: 20_000, deleteFirst: true }).catch((error) => {
        logError('erasure_start_failed', { message: errorText(error) });
        return erasure;
      });
      return {
        id: tenant._id.toHexString(),
        sites: siteCount,
        trackingStopped: !!progress.kvDoneAt,
        dataDeleteSent: !!progress.dataDeleteSentAt || (progress.rowsFound !== null && Object.values(progress.rowsFound).every((n) => n === 0)),
        finishesWithinDays: ERASURE_SETTLE_DAYS + 1,
      };
    },
  };
}
export type AccountService = ReturnType<typeof createAccountService>;
