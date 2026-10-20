import type { SiteHealthDoc } from '../models/site-health.model';
import type { SiteDoc } from '../models/site.model';
import { lastSignal } from '../services/health.service';
import { LABELS } from '../services/verifier';
import type { CheckId } from '../services/verifier';

const HOUR = 3_600_000;

export function healthView(site: SiteDoc, h: SiteHealthDoc | null) {
  const none = { reason: null, failedCheck: null, failedLabel: null, movedTo: null, since: null, checkedAt: null, lastEventAt: null, silentForHours: null, silentHours: null };
  if (site.status === 'paused') return { status: 'paused' as const, ...none };
  if (!h) return { status: 'unknown' as const, ...none };
  const last = lastSignal(site, h.lastEventAt ? { lastAt: h.lastEventAt, maxGapMinutes: 0 } : undefined);
  return {
    status: h.status,
    reason: h.reason,
    failedCheck: h.failedCheck,
    failedLabel: h.failedCheck === 'moved' ? 'Site moved' : h.failedCheck ? (LABELS[h.failedCheck as CheckId] ?? null) : null,
    movedTo: h.movedTo ?? null,
    since: h.since.toISOString(),
    checkedAt: h.checkedAt.toISOString(),
    lastEventAt: h.lastEventAt?.toISOString() ?? null,
    /** Hours without data when it was checked (the banner says "nothing for 8 hours"). */
    silentForHours: Math.max(0, Math.floor((h.checkedAt.getTime() - last.getTime()) / HOUR)),
    silentHours: h.silentHours,
  };
}
