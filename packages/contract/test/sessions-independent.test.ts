import { describe, expect, it } from 'vitest';
import { AUTOMATIC_EVENTS, LIMITS, sessionise } from '../src';
import type { MetricEvent } from '../src';
import { sessionEvents } from '../fixtures/sessions';

// A SECOND implementation, written differently on purpose: one pass in global time order with a map of open
// sessions (the reference sorts per visitor instead). If the two ever disagree, a definition is ambiguous.
// This is the executable form of the Stage 1 "two people compute the same session count" check.
interface Sess { visitor: string; start: number; end: number; pageviews: number; customEvents: number; engagementMs: number }

function independent(events: readonly MetricEvent[]) {
  const ordered = [...events].sort((a, b) => a.t - b.t || (a.visitor < b.visitor ? -1 : a.visitor > b.visitor ? 1 : 0));
  const open = new Map<string, Sess>();
  const done: Sess[] = [];
  for (const e of ordered) {
    let s = open.get(e.visitor);
    if (s && e.t - s.end > LIMITS.sessionGapMs) {
      done.push(s);
      s = undefined;
    }
    if (!s) {
      s = { visitor: e.visitor, start: e.t, end: e.t, pageviews: 0, customEvents: 0, engagementMs: 0 };
      open.set(e.visitor, s);
    }
    s.end = e.t;
    s.engagementMs += e.engagementMs ?? 0;
    if (e.name === 'pageview') s.pageviews += 1;
    else if (!AUTOMATIC_EVENTS.has(e.name)) s.customEvents += 1;
  }
  done.push(...open.values());
  return done
    .map((s) => ({
      ...s,
      id: Math.floor(s.start / 1000),
      engaged: s.engagementMs > 10_000 || s.customEvents > 0 || s.pageviews > 1,
    }))
    .sort((a, b) => (a.visitor < b.visitor ? -1 : a.visitor > b.visitor ? 1 : a.start - b.start));
}

const reference = (events: readonly MetricEvent[]) =>
  sessionise(events).sort((a, b) => (a.visitor < b.visitor ? -1 : a.visitor > b.visitor ? 1 : a.start - b.start));

// small deterministic random generator (mulberry32) so a failure is reproducible
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('two independent implementations agree', () => {
  it('on the hand-worked fixture', () => {
    expect(independent(sessionEvents)).toEqual(reference(sessionEvents));
  });

  it('on 300 random event streams that deliberately sit on the 30-minute boundary', () => {
    const gaps = [0, 1, 1000, 29 * 60_000, 30 * 60_000 - 1, 30 * 60_000, 30 * 60_000 + 1, 31 * 60_000, 3 * 3_600_000];
    const names = ['pageview', 'pageview', 'pageview', 'signup', 'scroll', 'engagement', 'checkout_done'];
    const visitors = ['v1', 'v2', 'v3', 'v4'];
    const t0 = Date.UTC(2026, 9, 1, 0, 0, 0);
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed);
      const events: MetricEvent[] = [];
      for (const visitor of visitors) {
        let t = t0 + Math.floor(r() * 3_600_000);
        const n = 1 + Math.floor(r() * 8);
        for (let i = 0; i < n; i++) {
          events.push({
            visitor,
            t,
            name: names[Math.floor(r() * names.length)]!,
            engagementMs: r() < 0.4 ? [0, 3000, 10_000, 10_001, 25_000][Math.floor(r() * 5)]! : undefined,
          });
          t += gaps[Math.floor(r() * gaps.length)]!;
        }
      }
      expect(independent(events), `seed ${seed}`).toEqual(reference(events));
    }
  });
});