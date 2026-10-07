import { AUTOMATIC_EVENTS, LIMITS } from './limits';
import type { MetricEvent, Session } from './metrics';

/**
 * Incremental form of sessionise() for the consumer, which sees one event at a
 * time (per visitor) instead of a whole day.
 *
 * Contract: feeding a visitor's events in time order through advanceSession()
 * produces exactly the sessions that sessionise() produces for the same events.
 * That equivalence is tested, so the metric definition lives in one place.
 */
export interface SessionState extends Session {
  /**
   * Row version for ClickHouse VersionedCollapsingMergeTree. Starts at 1 and
   * increases by 1 for every state change of the same session.
   */
  version: number;
}

export interface AdvanceResult {
  /** The state after applying the event. Store this as the visitor's current session. */
  next: SessionState;
  /** True when the event opened a new session (no previous state, another visitor, or the gap was exceeded). */
  started: boolean;
  /** The state to cancel (sign = -1) in ClickHouse; null when a new session started. */
  previous: SessionState | null;
  /**
   * True when the event is older than the session's last event. It is still
   * counted, but start and id never move because id is part of the sort key.
   */
  late: boolean;
}

const isEngaged = (s: Pick<Session, 'engagementMs' | 'customEvents' | 'pageviews'>): boolean =>
  s.engagementMs > LIMITS.engagedMinMs || s.customEvents >= 1 || s.pageviews >= 2;

export function advanceSession(prev: SessionState | null, e: MetricEvent): AdvanceResult {
  const started = prev === null || prev.visitor !== e.visitor || e.t - prev.end > LIMITS.sessionGapMs;

  const base: SessionState = started
    ? {
        visitor: e.visitor,
        id: Math.floor(e.t / 1000),
        start: e.t,
        end: e.t,
        pageviews: 0,
        customEvents: 0,
        engagementMs: 0,
        engaged: false,
        version: 1,
      }
    : { ...(prev as SessionState), version: (prev as SessionState).version + 1 };

  const next: SessionState = {
    ...base,
    end: Math.max(base.end, e.t),
    engagementMs: base.engagementMs + (e.engagementMs ?? 0),
    pageviews: base.pageviews + (e.name === 'pageview' ? 1 : 0),
    customEvents: base.customEvents + (e.name !== 'pageview' && !AUTOMATIC_EVENTS.has(e.name) ? 1 : 0),
    engaged: false,
  };
  next.engaged = isEngaged(next);

  return {
    next,
    started,
    previous: started ? null : (prev as SessionState),
    late: !started && prev !== null && e.t < prev.end,
  };
}