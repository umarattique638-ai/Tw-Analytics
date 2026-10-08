export const visitorsSeries = [
  { date: 'Mon', visitors: 520, sessions: 640 },
  { date: 'Tue', visitors: 610, sessions: 730 },
  { date: 'Wed', visitors: 580, sessions: 690 },
  { date: 'Thu', visitors: 720, sessions: 860 },
  { date: 'Fri', visitors: 690, sessions: 820 },
  { date: 'Sat', visitors: 430, sessions: 510 },
  { date: 'Sun', visitors: 617, sessions: 740 },
];

export const sources = [
  { name: 'Direct', value: 42 },
  { name: 'Search', value: 28 },
  { name: 'Social', value: 17 },
  { name: 'Referral', value: 13 },
];

export type Row = { label: string; value: number; pct: number };

export const devices: Row[] = [
  { label: 'Desktop', value: 2410, pct: 58 },
  { label: 'Mobile', value: 1520, pct: 36 },
  { label: 'Tablet', value: 237, pct: 6 },
];
export const browsers: Row[] = [
  { label: 'Chrome', value: 2480, pct: 60 },
  { label: 'Safari', value: 960, pct: 23 },
  { label: 'Firefox', value: 420, pct: 10 },
  { label: 'Edge', value: 307, pct: 7 },
];
export const topPages: Row[] = [
  { label: '/', value: 2140, pct: 100 },
  { label: '/pricing', value: 1260, pct: 59 },
  { label: '/blog/privacy-analytics', value: 980, pct: 46 },
  { label: '/docs/install', value: 720, pct: 34 },
  { label: '/signup', value: 540, pct: 25 },
];
export const locations: Row[] = [
  { label: 'United States', value: 1320, pct: 32 },
  { label: 'Germany', value: 890, pct: 21 },
  { label: 'Pakistan', value: 610, pct: 15 },
  { label: 'United Kingdom', value: 480, pct: 12 },
];

export type LiveEvent = { id: number; type: 'pageview' | 'click' | 'signup' | 'purchase'; url: string; ago: string };
export const liveEvents: LiveEvent[] = [
  { id: 1, type: 'pageview', url: '/pricing', ago: '2s ago' },
  { id: 2, type: 'click', url: '/ #get-started', ago: '14s ago' },
  { id: 3, type: 'signup', url: '/signup', ago: '48s ago' },
  { id: 4, type: 'pageview', url: '/docs/install', ago: '1m ago' },
  { id: 5, type: 'purchase', url: '/checkout', ago: '3m ago' },
  { id: 6, type: 'pageview', url: '/blog/privacy-analytics', ago: '4m ago' },
];