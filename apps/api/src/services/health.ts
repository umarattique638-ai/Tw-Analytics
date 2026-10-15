import type { SiteActivity } from '../analytics';
import { errorText, logError, logInfo } from '../http/errors';
import { pipelineSilentMail, siteBrokenMail, siteRecoveredMail } from '../mail';
import type { SiteDoc, SiteHealthDoc } from '../store/types';
import { LABELS, runActiveCheck } from '../verifier';
import type { CheckId } from '../verifier';
import type { Services } from './types';

/**
 * Is each site still sending data? (decision 28)
 *
 * A site is "silent" when no event arrived for longer than its usual longest pause:
 *   threshold = 2 x the longest gap between events over the last 7 days, kept between 6 hours and 3 days;
 *   a site verified less than 2 days ago: 24 hours (no habit to learn from yet).
 * A silent site is opened and the install check runs (the same 7 steps as setup):
 *   a step fails      -> broken: red banner, one e-mail to the owners and admins, an activity line
 *   every step passes -> quiet:  the install is fine, there were simply no visitors (no e-mail)
 * Data again after "broken" -> healthy, an activity line, and one "sending again" e-mail if we sent one.
 *
 * If most sites go silent at once the fault is ours (collector, queue, consumer, ClickHouse): customers are
 * not e-mailed, the operator is (TW_OWNER_EMAIL).
 *
 * Runs nightly (/internal/health) and when the dashboard opens a site (GET /sites/:id/health, at most
 * once an hour per site unless "Check again").
 */
export const HEALTH_WINDOW_DAYS = 7;
export const NEW_SITE_DAYS = 2;
export const NEW_SITE_SILENT_HOURS = 24;
export const MIN_SILENT_HOURS = 6;
export const MAX_SILENT_HOURS = 72;
/** The dashboard re-checks a site only when the stored result is older than this. */
export const RECHECK_MINUTES = 60;
/** "Most sites at once": more than half of them, and at least this many. */
export const PIPELINE_MIN_SILENT = 3;
/**
 * New install checks start only within this time (each fetch has its own 10 s limit), so the nightly call
 * stays inside Vercel's 30 s. Sites not reached are first in line the next night (oldest result first).
 */
const HEALTH_BUDGET_MS = 10_000;
const CHECKS_AT_ONCE = 4;

const HOUR = 3_600_000;

/** How long a site may stay without data before we look at it, in whole hours. */
export function silentHoursFor(site: Pick<SiteDoc, 'verifiedAt' | 'createdAt'>, activity: SiteActivity | undefined, now: Date): number {
  const since = (site.verifiedAt ?? site.createdAt).getTime();
  if (now.getTime() - since < NEW_SITE_DAYS * 24 * HOUR) return NEW_SITE_SILENT_HOURS;
  const habit = Math.ceil((2 * (activity?.maxGapMinutes ?? 0)) / 60);
  return Math.min(MAX_SILENT_HOURS, Math.max(MIN_SILENT_HOURS, habit));
}

/** The last time data arrived, never earlier than the verification (a site added again starts fresh). */
export function lastSignal(site: Pick<SiteDoc, 'verifiedAt' | 'createdAt'>, activity: SiteActivity | undefined): Date {
  const verified = site.verifiedAt ?? site.createdAt;
  return activity && activity.lastAt > verified ? activity.lastAt : verified;
}

export function isSilent(site: Pick<SiteDoc, 'verifiedAt' | 'createdAt'>, activity: SiteActivity | undefined, now: Date): boolean {
  return now.getTime() - lastSignal(site, activity).getTime() >= silentHoursFor(site, activity, now) * HOUR;
}

/** "5 hours", "2 days" */
export function spanText(ms: number): string {
  const h = Math.max(1, Math.round(ms / HOUR));
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'}`;
  const d = Math.round(h / 24);
  return `${d} days`;
}

/** Only these are watched: stored, verified, not paused (a paused site is silent on purpose). */
export const watched = (site: SiteDoc) => site.status === 'active' && !!site.verifiedAt;

/** A stored result that belongs to an earlier life of the site (deleted, then added again) is ignored. */
export const current = (site: SiteDoc, h: SiteHealthDoc | undefined | null) =>
  h && site.verifiedAt && h.checkedAt.getTime() >= site.verifiedAt.getTime() ? h : null;

export function healthView(site: SiteDoc, h: SiteHealthDoc | null) {
  const none = { reason: null, failedCheck: null, failedLabel: null, since: null, checkedAt: null, lastEventAt: null, silentForHours: null, silentHours: null };
  if (site.status === 'paused') return { status: 'paused' as const, ...none };
  if (!h) return { status: 'unknown' as const, ...none };
  const last = lastSignal(site, h.lastEventAt ? { lastAt: h.lastEventAt, maxGapMinutes: 0 } : undefined);
  return {
    status: h.status,
    reason: h.reason,
    failedCheck: h.failedCheck,
    failedLabel: h.failedCheck ? (LABELS[h.failedCheck as CheckId] ?? null) : null,
    since: h.since.toISOString(),
    checkedAt: h.checkedAt.toISOString(),
    lastEventAt: h.lastEventAt?.toISOString() ?? null,
    /** Hours without data when it was checked (the banner says "nothing for 8 hours"). */
    silentForHours: Math.max(0, Math.floor((h.checkedAt.getTime() - last.getTime()) / HOUR)),
    silentHours: h.silentHours,
  };
}

export function createHealthService(s: Services) {
  const { store, mailer, config, audit, now } = s;
  const reader = s.deps.analytics;
  const verifierOptions = { allowPrivate: config.verifierAllowPrivate, ...s.deps.verifier };
  const dashboardLink = (site: SiteDoc) => `${config.publicUrl}/dashboard?site=${site._id}`;

  /** Owners and admins of the site's workspace, with a usable address. */
  const recipients = async (site: SiteDoc) => {
    const people: { email: string; name: string | null }[] = [];
    for (const m of await store.membersOf(site.tenantId)) {
      if (m.role === 'viewer') continue;
      const u = await store.userById(m.userId);
      if (u && u.status === 'active' && u.emailVerifiedAt !== null) people.push({ email: u.email, name: u.name ?? null });
    }
    return people;
  };

  const mailAll = async (site: SiteDoc, make: (to: string, name: string | null) => Parameters<typeof mailer.send>[0]) => {
    if (!mailer.configured) return false;
    let sent = false;
    for (const p of await recipients(site)) {
      try {
        await mailer.send(make(p.email, p.name));
        sent = true;
      } catch (error) {
        logError('health_mail_failed', { site: site._id, message: errorText(error) });
      }
    }
    return sent;
  };

  /**
   * Works out the site's state now, saves it, and does what a change calls for (activity line, e-mail).
   * `mayAlert`: the "stopped sending" e-mail may go out (nightly, unless the pipeline itself looks down).
   */
  async function evaluate(site: SiteDoc, activity: SiteActivity | undefined, prevRaw: SiteHealthDoc | null, mayAlert: boolean): Promise<SiteHealthDoc> {
    const at = now();
    const prev = current(site, prevRaw);
    const silentHours = silentHoursFor(site, activity, at);
    let status: SiteHealthDoc['status'] = 'healthy';
    let reason: string | null = null;
    let failedCheck: string | null = null;

    if (isSilent(site, activity, at)) {
      const result = await runActiveCheck(site, undefined, verifierOptions);
      const failed = result.checks.find((c) => c.status === 'fail');
      if (result.ok || !failed) status = 'quiet';
      else {
        status = 'broken';
        failedCheck = failed.id;
        reason = `${failed.label}: ${failed.message}`.slice(0, 500);
      }
    }

    const next: SiteHealthDoc = {
      _id: site._id,
      tenantId: site.tenantId,
      status,
      reason,
      failedCheck,
      since: prev && prev.status === status ? prev.since : at,
      checkedAt: at,
      lastEventAt: activity?.lastAt ?? prev?.lastEventAt ?? null,
      silentHours,
      alertedAt: prev?.alertedAt ?? null,
    };

    const silence = spanText(at.getTime() - lastSignal(site, activity).getTime());
    if (status === 'broken' && prev?.status !== 'broken') {
      await audit.write(site.tenantId, null, 'site.stopped_sending', site._id, `${site.domain} stopped sending data (nothing for ${silence}). ${reason}`.slice(0, 500));
    }
    if (prev?.status === 'broken' && status !== 'broken') {
      await audit.write(
        site.tenantId,
        null,
        'site.sending_again',
        site._id,
        status === 'healthy' ? `${site.domain} is sending data again` : `The install check of ${site.domain} passes again`,
      );
    }
    // "Sending again" only once data really arrives (an install fixed but still without visitors waits).
    if (status === 'healthy' && next.alertedAt) {
      await mailAll(site, (to, name) => siteRecoveredMail(to, name, site.domain, dashboardLink(site)));
      next.alertedAt = null;
    }
    if (status === 'broken' && !next.alertedAt && mayAlert) {
      if (await mailAll(site, (to, name) => siteBrokenMail(to, name, site.domain, silence, reason!, dashboardLink(site)))) next.alertedAt = at;
    }
    await store.saveHealth(next);
    return next;
  }

  return {
    /** ClickHouse can tell when data last arrived (without it there is nothing to judge). */
    get configured() {
      return !!reader.siteActivity;
    },

    async stored(site: SiteDoc): Promise<SiteHealthDoc | null> {
      return current(site, (await store.healthOf([site._id]))[0]);
    },

    /** One site, for the dashboard. Never e-mails "stopped sending" (the person is looking at it). */
    async checkOne(site: SiteDoc): Promise<SiteHealthDoc | null> {
      if (!watched(site) || !reader.siteActivity) return null;
      const [activity, [prev]] = await Promise.all([reader.siteActivity([site._id], HEALTH_WINDOW_DAYS), store.healthOf([site._id])]);
      return evaluate(site, activity.get(site._id), prev ?? null, false);
    },

    /** Stored result is missing or older than RECHECK_MINUTES. */
    stale(site: SiteDoc, h: SiteHealthDoc | null) {
      return !h || now().getTime() - h.checkedAt.getTime() > RECHECK_MINUTES * 60_000;
    },

    /** The nightly run over every watched site. */
    async runAll() {
      const deadline = Date.now() + HEALTH_BUDGET_MS;
      const result = { configured: !!reader.siteActivity, sites: 0, healthy: 0, quiet: 0, broken: 0, silent: 0, notChecked: 0, failed: 0, pipelineSuspect: false };
      if (!reader.siteActivity) return result;
      const sites = (await store.allSites()).filter(watched);
      result.sites = sites.length;
      if (!sites.length) return result;
      const at = now();
      const activity = await reader.siteActivity(
        sites.map((x) => x._id),
        HEALTH_WINDOW_DAYS,
      );
      const prevOf = new Map((await store.healthOf(sites.map((x) => x._id))).map((h) => [h._id, h]));
      const silent = sites.filter((x) => isSilent(x, activity.get(x._id), at));
      result.silent = silent.length;
      result.pipelineSuspect = silent.length >= PIPELINE_MIN_SILENT && silent.length * 2 > sites.length;

      if (result.pipelineSuspect) {
        logError('health_pipeline_silent', { silent: silent.length, sites: sites.length });
        if (config.ownerEmail && mailer.configured) {
          await mailer
            .send(pipelineSilentMail(config.ownerEmail, silent.length, sites.length, silent.map((x) => x.domain)))
            .catch((error) => logError('health_mail_failed', { message: errorText(error) }));
        }
      }

      const tally = (h: SiteHealthDoc) => (result[h.status] += 1);
      const run = async (site: SiteDoc) => {
        try {
          tally(await evaluate(site, activity.get(site._id), prevOf.get(site._id) ?? null, !result.pipelineSuspect));
        } catch (error) {
          result.failed += 1;
          logError('health_check_failed', { site: site._id, message: errorText(error) });
        }
      };

      // Sites with data first: no fetching, quick (and a recovery is never held up by the slow ones).
      const silentIds = new Set(silent.map((x) => x._id));
      for (const site of sites.filter((x) => !silentIds.has(x._id))) await run(site);
      // Then the silent ones, a few at a time, the longest unchecked first, until the time is used up.
      const queue = [...silent].sort((a, b) => (prevOf.get(a._id)?.checkedAt.getTime() ?? 0) - (prevOf.get(b._id)?.checkedAt.getTime() ?? 0));
      const worker = async () => {
        for (let site = queue.shift(); site; site = queue.shift()) {
          if (Date.now() > deadline) {
            result.notChecked += 1;
            continue;
          }
          await run(site);
        }
      };
      await Promise.all(Array.from({ length: CHECKS_AT_ONCE }, worker));
      logInfo('health', result);
      return result;
    },
  };
}
export type HealthService = ReturnType<typeof createHealthService>;
