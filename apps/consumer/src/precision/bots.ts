import { BOTS } from './lists/bots.generated';
import type { BotEntry } from './lists/bots.generated';

/**
 * The full Matomo device-detector bots.yml pass (Stage 7, PLAN 2.4 "consumer: full precision").
 *
 * Applied exactly like device-detector's AbstractParser::matchUserAgent: each regex is wrapped as
 * `(?:^|[^A-Z0-9_\-])(?:REGEX)` and matched case-insensitively, first entry wins.
 *
 * Cost: one combined test per event (~50 µs on a human UA, which matches nothing). Only a UA that
 * matches is then walked entry by entry to find WHICH bot it is (the itemised reason).
 * The combined regex is run TWICE at module load. Measured (Node 22 / V8): 1st test ~55 ms (bytecode
 * compile), 2nd ~26 ms (tier-up to native code), then ~0.1 ms. Both one-off costs belong in Worker
 * startup (its own limit, not the per-invocation CPU budget of the Free plan), never in a batch.
 */

/**
 * TailWatch's own additions, for gaps the regression corpus found in the upstream list. Never edit the
 * generated upstream file (LGPL, see infra/lists/SOURCES.md); add here, with a corpus row that proves it.
 * Checked after the upstream list, same matching rules.
 */
const OWN: readonly BotEntry[] = [
  // WhatsApp's link-preview fetcher sends a bare "WhatsApp/2.23.20.0 A"; the in-app browser starts with Mozilla/.
  { regex: '^WhatsApp/[\\d.]+', name: 'WhatsApp link preview', category: 'Social Media Agent' },
];
const ALL: readonly BotEntry[] = [...BOTS, ...OWN];

const wrap = (source: string) => `(?:^|[^A-Z0-9_\\-])(?:${source})`;

const ANY = new RegExp(wrap(ALL.map((b) => b.regex).join('|')), 'i');
ANY.test('Mozilla/5.0 (warm-up 1)');
ANY.test('Mozilla/5.0 (warm-up 2)');

/** Compiled on demand: only UAs that already matched ANY ever get here. */
const single = new Map<number, RegExp>();
const entryRe = (i: number): RegExp => {
  let re = single.get(i);
  if (!re) single.set(i, (re = new RegExp(wrap(ALL[i]!.regex), 'i')));
  return re;
};

export interface BotMatch {
  name: string;
  category: string;
  /**
   * Only bots.yml's last catch-all ("Generic Bot": tokens like security, monitor, proxy, study) matched,
   * on a UA that is otherwise a normal browser. Not enough to drop on its own (Stage 7 review): it is a
   * weak signal for the headless scoring instead.
   */
  weak: boolean;
}

/** Index of the upstream catch-all, the very last upstream entry. */
const CATCH_ALL = BOTS.length - 1;
const BROWSER_LIKE = /^Mozilla\/5\.0 \([^)]+\) (?:AppleWebKit|Gecko)\/[\d.]+.*(?:Chrome|Safari|Firefox|Edg|OPR)\/[\d.]+/;

/** device-detector names like '$1' take the regex's capture group. */
function nameOf(entry: BotEntry, m: RegExpExecArray): string {
  return entry.name.replace(/\$(\d)/g, (_, d: string) => m[Number(d)] ?? '').trim() || entry.name;
}

export function matchBotsYml(userAgent: string | undefined): BotMatch | null {
  if (!userAgent || !ANY.test(userAgent)) return null;
  for (let i = 0; i < ALL.length; i += 1) {
    const m = entryRe(i).exec(userAgent);
    if (m) return { name: nameOf(ALL[i]!, m), category: ALL[i]!.category, weak: i === CATCH_ALL && BROWSER_LIKE.test(userAgent) };
  }
  return null; // unreachable in practice: ANY matched, so one entry does
}

export const BOTS_YML_ENTRIES = BOTS.length;
export const OWN_BOT_ENTRIES = OWN.length;
