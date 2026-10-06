import { describe, expect, it } from 'vitest';
import { sessionise, summarise } from '../src';
import { sessionEvents, sessionExpected, sessionExpectedList } from '../fixtures/sessions';

describe('metric definitions (PLAN 5) against the hand-worked fixture', () => {
  it('reproduces the hand-worked totals', () => {
    const s = summarise(sessionEvents);
    expect(s).toMatchObject({
      sessions: sessionExpected.sessions,
      engagedSessions: sessionExpected.engagedSessions,
      pageviews: sessionExpected.pageviews,
      uniqueVisitors: sessionExpected.uniqueVisitors,
    });
    expect(s.bounceRate).toBeCloseTo(sessionExpected.bounceRate, 12);
  });

  it('reproduces every session, one by one', () => {
    const got = sessionise(sessionEvents).map(({ visitor, pageviews, customEvents, engagementMs, engaged }) => ({
      visitor, pageviews, customEvents, engagementMs, engaged,
    }));
    expect(got).toEqual(sessionExpectedList);
  });

  it('does not depend on input order', () => {
    expect(summarise([...sessionEvents].reverse())).toEqual(summarise(sessionEvents));
  });

  it('does not split a session at midnight UTC', () => {
    const a = sessionise(sessionEvents).filter((s) => s.visitor === 'A');
    expect(a).toHaveLength(2);
    expect(a[0]!.pageviews).toBe(3);
  });

  it('does not split a session when the campaign changes', () => {
    expect(sessionise(sessionEvents).filter((s) => s.visitor === 'C')).toHaveLength(1);
  });

  it('a gap of exactly 30:00 stays, 30:00.001 splits', () => {
    expect(sessionise(sessionEvents).filter((s) => s.visitor === 'E')).toHaveLength(1);
    expect(sessionise(sessionEvents).filter((s) => s.visitor === 'F')).toHaveLength(2);
  });

  it('exactly 10 s visible is not engaged', () => {
    expect(sessionise(sessionEvents).find((s) => s.visitor === 'H')!.engaged).toBe(false);
  });

  it('session_id is the start time in unix seconds', () => {
    const s = sessionise(sessionEvents).find((x) => x.visitor === 'B')!;
    expect(s.id).toBe(Math.floor(s.start / 1000));
  });

  it('an empty period has no sessions and a bounce rate of 0, not NaN', () => {
    expect(summarise([])).toEqual({ sessions: 0, engagedSessions: 0, bounceRate: 0, pageviews: 0, uniqueVisitors: 0 });
  });
});