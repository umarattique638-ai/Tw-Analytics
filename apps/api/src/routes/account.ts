import { gzipSync } from 'node:zlib';
import { deleteCookie } from 'hono/cookie';
import { RETENTION_CHOICES } from '../config';
import { DELETE_CONFIRMATION, SESSION_COOKIE } from '../constants';
import { HttpError, errorText, logError, logInfo } from '../http/errors';
import { body, str } from '../http/request';
import type { Api } from '../http/types';
import { ERASURE_SETTLE_DAYS, advanceErasure } from '../jobs';
import { accountDeletedMail } from '../mail';
import { verifyPassword } from '../passwords';
import type { Services } from '../services';
import { buildAccountExport } from '../services/account-export';
import { localDate } from '../stats';
import type { ErasureDoc } from '../store/types';
import { count, userView } from '../views';

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
export function accountRoutes(app: Api, s: Services) {
  const { store, config, limits, mailer, sites, audit, now } = s;

  app.get('/me', async (c) => {
    const t = c.get('tenant');
    return c.json({
      user: userView(c.get('user')),
      tenant: { id: t._id.toHexString(), plan: t.plan, region: t.region },
      role: (await sites.roleOf(c)) ?? 'viewer',
      retention: { choices: RETENTION_CHOICES.filter((d) => d <= config.retentionDays), max: config.retentionDays, default: config.retentionDays },
    });
  });

  /**
   * "Download your data": one JSON file (services/account-export.ts). Sent gzip-compressed when the browser
   * accepts it (every browser does): a big account stays far below Vercel's response size limit.
   */
  app.get('/account/export', async (c) => {
    const at = now();
    const { data, siteCount } = await buildAccountExport(s, c.get('tenant'), c.get('user'), at);
    const json = JSON.stringify(data);
    await audit.record(c, 'account.exported', null, `Downloaded all account data (${count(siteCount, 'site')})`);
    c.header('content-type', 'application/json; charset=utf-8');
    c.header('content-disposition', `attachment; filename="tailwatch-export-${localDate(at, 'UTC')}.json"`);
    if (/\bgzip\b/.test(c.req.header('accept-encoding') ?? '')) {
      c.header('content-encoding', 'gzip');
      c.header('vary', 'accept-encoding');
      return c.body(new Uint8Array(gzipSync(json)));
    }
    return c.body(json);
  });

  /**
   * Delete the account (owner only, password + typed confirmation). Everything in MongoDB goes at once, in
   * one transaction, and an erasure record remembers what is left: the sites' Cloudflare KV keys and their
   * ClickHouse rows. Both are started here (ClickHouse with a time limit: Vercel stops at 30 s); the
   * nightly job finishes, verifies after ERASURE_SETTLE_DAYS that nothing is left, e-mails the owner, and
   * keeps watching for ERASURE_WATCH_DAYS.
   */
  app.post('/account/delete', async (c) => {
    const b = await body(c);
    const user = c.get('user');
    const tenant = c.get('tenant');
    if (str(b.confirm) !== DELETE_CONFIRMATION) throw new HttpError(400, 'confirm_required', `Type ${DELETE_CONFIRMATION} to confirm.`);
    if (!limits.deleteAccount.take(`user:${user._id.toHexString()}`, Date.now())) {
      throw new HttpError(429, 'rate_limited', 'Too many attempts. Wait 15 minutes and try again.');
    }
    if (!user.passwordHash || !(await verifyPassword(str(b.password), user.passwordHash))) {
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
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: config.secureCookies });
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
    return c.json({
      ok: true,
      erasure: {
        id: tenant._id.toHexString(),
        sites: siteCount,
        trackingStopped: !!progress.kvDoneAt,
        dataDeleteSent: !!progress.dataDeleteSentAt || (progress.rowsFound !== null && Object.values(progress.rowsFound).every((n) => n === 0)),
        finishesWithinDays: ERASURE_SETTLE_DAYS + 1,
      },
    });
  });
}
