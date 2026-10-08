import type { ValidatedEvent } from '@tailwatch/contract';
import { matchBotsYml } from './bots';
import { headlessVerdict } from './headless';
import { referrerSpamDomain } from './referrer-spam';

/**
 * The consumer's precision pass (Stage 7, PLAN 2.4): everything debatable is decided HERE, after the
 * edge's cheap checks, and every verdict is itemised in dropped_hits with a reason the customer can read:
 *
 *   bot            bots_yml:<bot name>          one of the 843 Matomo device-detector entries
 *   bot            headless:<signal+signal>     headless / automation scoring (headless.ts)
 *   referrer_spam  <listed domain>              Matomo referrer-spam list
 *
 * Order: named bots first (the most specific reason), then headless, then referrer spam.
 */

export interface PrecisionVerdict {
  reason: 'bot' | 'referrer_spam';
  detail: string;
}

export function precisionVerdict(event: Pick<ValidatedEvent, 'userAgent' | 'width' | 'hints' | 'referrer' | 'flags'>): PrecisionVerdict | null {
  const bot = matchBotsYml(event.userAgent);
  if (bot && !bot.weak) return { reason: 'bot', detail: `bots_yml:${bot.name}` };
  const headless = headlessVerdict({ ...event, extraWeak: bot?.weak ? ['generic_bot_token'] : [] });
  if (headless) return { reason: 'bot', detail: headless };
  const spam = referrerSpamDomain(event.referrer);
  if (spam) return { reason: 'referrer_spam', detail: spam };
  return null;
}

export { matchBotsYml, BOTS_YML_ENTRIES } from './bots';
export { headlessScore, headlessVerdict } from './headless';
export { referrerSpamDomain, REFERRER_SPAM_DOMAINS } from './referrer-spam';
