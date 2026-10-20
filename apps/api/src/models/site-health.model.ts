import type { ObjectId } from 'mongodb';

/**
 * Is a site still sending data (decision 28)? One per site, written by the health check (services/health.service.ts).
 *   healthy  data arrived recently (for this site's usual rhythm)
 *   quiet    no data for a while, but the install check passes: simply no visitors
 *   broken   no data for a while AND the install check fails (`failedCheck`, `reason`)
 * `alertedAt` is set once the "stopped sending data" e-mail went out (cleared by the recovery e-mail).
 */
export interface SiteHealthDoc {
  _id: number;
  tenantId: ObjectId;
  status: 'healthy' | 'quiet' | 'broken';
  reason: string | null;
  failedCheck: string | null;
  /** failedCheck "moved": the host the visits now come from (decision 29). */
  movedTo?: string | null;
  since: Date;
  checkedAt: Date;
  lastEventAt: Date | null;
  silentHours: number;
  alertedAt: Date | null;
  /** When the last "unusual traffic" e-mail went out (decision 31): at most one a day. */
  spikeAlertedAt?: Date | null;
}
