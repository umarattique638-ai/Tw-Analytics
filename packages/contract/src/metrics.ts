import { AUTOMATIC_EVENTS, LIMITS } from './limits';


export interface MetricEvent {
  visitor: string;
  t: number; 
  name: string;
  engagementMs?: number; 
  utm?: string; 
}

export interface Session {
  visitor: string;
  id: number; 
  start: number;
  end: number;
  pageviews: number;
  customEvents: number;
  engagementMs: number;
  engaged: boolean;
}

export function sessionise(events: readonly MetricEvent[]): Session[] {
  const sorted = [...events].sort((a, b) => (a.visitor < b.visitor ? -1 : a.visitor > b.visitor ? 1 : a.t - b.t));
  const out: Session[] = [];
  let cur: Session | null = null;
  for (const e of sorted) {
    if (!cur || cur.visitor !== e.visitor || e.t - cur.end > LIMITS.sessionGapMs) {
      cur = { visitor: e.visitor, id: Math.floor(e.t / 1000), start: e.t, end: e.t, pageviews: 0, customEvents: 0, engagementMs: 0, engaged: false };
      out.push(cur);
    }
    cur.end = e.t;
    cur.engagementMs += e.engagementMs ?? 0;
    if (e.name === 'pageview') cur.pageviews++;
    else if (!AUTOMATIC_EVENTS.has(e.name)) cur.customEvents++;
  }
  for (const s of out) s.engaged = s.engagementMs > LIMITS.engagedMinMs || s.customEvents >= 1 || s.pageviews >= 2;
  return out;
}

export function summarise(events: readonly MetricEvent[]) {
  const sessions = sessionise(events);
  const engagedSessions = sessions.filter((s) => s.engaged).length;
  return {
    sessions: sessions.length,
    engagedSessions,
    bounceRate: sessions.length ? 1 - engagedSessions / sessions.length : 0,
    pageviews: sessions.reduce((sum, s) => sum + s.pageviews, 0),
    uniqueVisitors: new Set(events.map((e) => e.visitor)).size,
  };
}