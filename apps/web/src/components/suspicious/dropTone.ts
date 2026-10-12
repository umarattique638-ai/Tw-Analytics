import type { BadgeTone } from '../ui/Badge';

const TONES: Record<string, { badge: BadgeTone; bar: string }> = {
  bot: { badge: 'rose', bar: 'bg-rose-500' },
  hostname: { badge: 'amber', bar: 'bg-amber-500' },
  verification_agent: { badge: 'neutral', bar: 'bg-slate-400' },
};

/** Colour per drop reason: red for bots, amber for a host to look at, grey for our own checks. */
export const dropTone = (reason: string) => TONES[reason] ?? { badge: 'violet' as BadgeTone, bar: 'bg-violet-500' };
