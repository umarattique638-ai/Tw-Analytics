import { describe, expect, it } from 'vitest';
import { advanceSession, sessionise } from '../src';
import type { MetricEvent, SessionState } from '../src';
import { sessionEvents } from '../fixtures/sessions';

/** Feed events one at a time, per visitor, in time order (what the consumer does). */
function incremental(events: readonly MetricEvent[]) {
  const sorted = [...events].sort((a, b) => (a.visitor < b.visitor ? -1 : a.visitor > b.visitor ? 1 : a.t - b.t));
  const out: SessionState[] = [];
  let cur: SessionState | null = null;
  for (const e of sorted) {
    const r = advanceSession(cur, e);
    if (r.started) out.push(r.next);
    else out[out.length - 1] = r.next;
    cur = r.next;
  }
  return out;
}

const strip = (s: { visitor: string; id: number; start: number; end: number; pageviews: number; customEvents: number; engagementMs: number; engaged: boolean }) => ({
  visitor: s.visitor, id: s.id, start: s.start, end: s.end, pageviews: s.pageviews,
  customEvents: s.customEvents, engagementMs: s.engagementMs, engaged: s.engaged,
});

describe('advanceSession equals sessionise', () => {
  it('on the hand-worked fixture', () => {
    expect(incremental(sessionEvents).map(strip)).toEqual(sessionise(sessionEvents).map(strip));
  });

  it('on 200 random event streams', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const names = ['pageview', 'pageview', 'scroll', 'engagement', 'signup', 'purchase'];
    for (let run = 0; run < 200; run++) {
      const events: MetricEvent[] = [];
      const visitors = 1 + Math.floor(rnd() * 4);
      let t = Date.UTC(2026, 9, 1);
      for (let i = 0; i < 1 + Math.floor(rnd() * 25); i++) {
        t += Math.floor(rnd() * 3_600_000); // up to 1 h, so gaps both under and over 30 min
        events.push({
          visitor: `v${Math.floor(rnd() * visitors)}`,
          t,
          name: names[Math.floor(rnd() * names.length)]!,
          engagementMs: rnd() < 0.3 ? Math.floor(rnd() * 20_000) : undefined,
        });
      }
      expect(incremental(events).map(strip)).toEqual(sessionise(events).map(strip));
    }
  });
});

describe('advanceSession versions and flags', () => {
  const ev = (t: number, name = 'pageview'): MetricEvent => ({ visitor: 'A', t, name });
  const T = Date.UTC(2026, 9, 1);

  it('first event starts version 1 with no previous state', () => {
    const r = advanceSession(null, ev(T));
    expect(r.started).toBe(true);
    expect(r.previous).toBeNull();
    expect(r.next.version).toBe(1);
  });

  it('a continued session bumps the version and returns the state to cancel', () => {
    const a = advanceSession(null, ev(T));
    const b = advanceSession(a.next, ev(T + 60_000));
    expect(b.started).toBe(false);
    expect(b.next.version).toBe(2);
    expect(b.next.id).toBe(a.next.id);
    expect(b.previous).toEqual(a.next);
  });

  it('exactly 30:00 continues, 30:00.001 starts a new session with version 1', () => {
    const a = advanceSession(null, ev(T)).next;
    expect(advanceSession(a, ev(T + 30 * 60_000)).started).toBe(false);
    const split = advanceSession(a, ev(T + 30 * 60_000 + 1));
    expect(split.started).toBe(true);
    expect(split.next.version).toBe(1);
    expect(split.next.id).toBe(Math.floor((T + 30 * 60_000 + 1) / 1000));
  });

  it('a late event is counted but start and id never move', () => {
    const a = advanceSession(null, ev(T + 60_000)).next;
    const r = advanceSession(a, ev(T, 'pageview'));
    expect(r.late).toBe(true);
    expect(r.next.pageviews).toBe(2);
    expect(r.next.id).toBe(a.id);
    expect(r.next.start).toBe(a.start);
    expect(r.next.end).toBe(a.end);
  });

  it('automatic events are not custom events, a custom event is', () => {
    const a = advanceSession(null, ev(T)).next;
    expect(advanceSession(a, ev(T + 1000, 'scroll')).next.customEvents).toBe(0);
    expect(advanceSession(a, ev(T + 1000, 'signup')).next.customEvents).toBe(1);
  });
});