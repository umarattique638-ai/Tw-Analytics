import type { MetricEvent } from '../src';

const BASE = Date.UTC(2026, 8, 30, 23, 50, 0);
const m = (min: number, extraMs = 0) => BASE + min * 60_000 + extraMs;

export const sessionEvents: MetricEvent[] = [

  { visitor: 'A', t: m(0), name: 'pageview' },
  { visitor: 'A', t: m(5), name: 'pageview' },
  { visitor: 'A', t: m(20), name: 'pageview' },
  { visitor: 'A', t: m(51), name: 'pageview', engagementMs: 4000 },

  { visitor: 'B', t: m(0), name: 'pageview', engagementMs: 12_000 },

  { visitor: 'C', t: m(0), name: 'pageview', utm: 'x' },
  { visitor: 'C', t: m(10), name: 'pageview', utm: 'y' },

  { visitor: 'D', t: m(0), name: 'pageview' },
  { visitor: 'D', t: m(2), name: 'signup' },

  { visitor: 'E', t: m(0), name: 'pageview' },
  { visitor: 'E', t: m(30), name: 'pageview' },

  { visitor: 'F', t: m(0), name: 'pageview' },
  { visitor: 'F', t: m(30, 1), name: 'pageview' },

  { visitor: 'G', t: m(0), name: 'pageview', engagementMs: 3000 },

  { visitor: 'H', t: m(0), name: 'pageview', engagementMs: 10_000 },

  { visitor: 'I', t: m(0), name: 'pageview' },
  { visitor: 'I', t: m(1), name: 'scroll' },
  { visitor: 'I', t: m(2), name: 'engagement', engagementMs: 3000 },
];

export const sessionExpectedList = [
  { visitor: 'A', pageviews: 3, customEvents: 0, engagementMs: 0, engaged: true }, // A1
  { visitor: 'A', pageviews: 1, customEvents: 0, engagementMs: 4000, engaged: false }, // A2
  { visitor: 'B', pageviews: 1, customEvents: 0, engagementMs: 12_000, engaged: true },
  { visitor: 'C', pageviews: 2, customEvents: 0, engagementMs: 0, engaged: true },
  { visitor: 'D', pageviews: 1, customEvents: 1, engagementMs: 0, engaged: true },
  { visitor: 'E', pageviews: 2, customEvents: 0, engagementMs: 0, engaged: true },
  { visitor: 'F', pageviews: 1, customEvents: 0, engagementMs: 0, engaged: false }, // F1
  { visitor: 'F', pageviews: 1, customEvents: 0, engagementMs: 0, engaged: false }, // F2
  { visitor: 'G', pageviews: 1, customEvents: 0, engagementMs: 3000, engaged: false },
  { visitor: 'H', pageviews: 1, customEvents: 0, engagementMs: 10_000, engaged: false },
  { visitor: 'I', pageviews: 1, customEvents: 0, engagementMs: 3000, engaged: false },
] as const;

export const sessionExpected = {
  sessions: 11, 
  engagedSessions: 5, 
  pageviews: 15, 
  uniqueVisitors: 9, 
  bounceRate: 1 - 5 / 11, 
};