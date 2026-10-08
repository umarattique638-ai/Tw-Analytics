// ---- Events ----
export type EventKind = 'automatic' | 'custom';
export type EventStatus = 'active' | 'new';
export interface EventRow {
  name: string; label: string; kind: EventKind; tier: string;
  count: number; last: string; status: EventStatus; conversion?: boolean;
}

export const events: EventRow[] = [
  { name: 'pageview', label: 'Pageview', kind: 'automatic', tier: 'Always on', count: 6474, last: 'just now', status: 'active' },
  { name: 'session_start', label: 'Session start', kind: 'automatic', tier: 'Always on', count: 5140, last: 'just now', status: 'active' },
  { name: 'first_visit', label: 'First visit', kind: 'automatic', tier: 'Always on', count: 2231, last: '1 min ago', status: 'active' },
  { name: 'engagement', label: 'Engagement time', kind: 'automatic', tier: 'Always on', count: 6102, last: 'just now', status: 'active' },
  { name: 'scroll', label: 'Scroll depth (25/50/75/90%)', kind: 'automatic', tier: 'Opt-in', count: 3380, last: '2 min ago', status: 'active' },
  { name: 'outbound_click', label: 'Outbound link click', kind: 'automatic', tier: 'Opt-in', count: 412, last: '9 min ago', status: 'active' },
  { name: 'file_download', label: 'File download', kind: 'automatic', tier: 'Opt-in', count: 96, last: '1 h ago', status: 'active' },
  { name: 'form_submit', label: 'Form submit', kind: 'automatic', tier: 'Opt-in', count: 188, last: '14 min ago', status: 'active' },
  { name: 'signup', label: 'Signup', kind: 'custom', tier: 'Code', count: 540, last: '48 s ago', status: 'active', conversion: true },
  { name: 'purchase', label: 'Purchase', kind: 'custom', tier: 'Server-side', count: 38, last: '3 min ago', status: 'active', conversion: true },
  { name: 'pricing_view', label: 'Pricing viewed', kind: 'custom', tier: 'Dashboard rule', count: 1260, last: '2 s ago', status: 'active' },
  { name: 'cta_click', label: 'CTA click', kind: 'custom', tier: 'HTML attribute', count: 214, last: '6 min ago', status: 'new' },
];

export const createPaths = [
  { id: 'code', label: 'Code', code: "tw.track('signup', { plan: 'pro', seats: 5 })", note: 'For developers. Needs a deploy.' },
  { id: 'html', label: 'HTML attribute', code: '<button data-tw-event="signup" data-tw-plan="pro">\n  Sign up\n</button>', note: 'For designers and CMS editors. Template edit only.' },
  { id: 'rule', label: 'Dashboard rule', code: '', note: 'For marketers. No code, no deploy.' },
] as const;

// ---- Suspicious activity ----
export type DropKind = 'bot' | 'hostname' | 'referrer spam' | 'verification agent';
export interface DroppedHit { id: number; at: string; reason: DropKind; detail: string; origin: string; hits: number }

export const dropped: DroppedHit[] = [
  { id: 1, at: '4 min ago', reason: 'bot', detail: 'HeadlessChrome, no screen size', origin: 'DE · datacentre ASN', hits: 142 },
  { id: 2, at: '12 min ago', reason: 'bot', detail: 'Known AI crawler (user agent match)', origin: 'US · cloud provider', hits: 96 },
  { id: 3, at: '48 min ago', reason: 'referrer spam', detail: 'Referrer on spam list: free-traffic-now.xyz', origin: 'RU', hits: 61 },
  { id: 4, at: '2 h ago', reason: 'hostname', detail: 'Hits from staging.example.io, not in allowed hosts', origin: 'PK', hits: 18 },
  { id: 5, at: '3 h ago', reason: 'bot', detail: 'Volume anomaly: 90 hits in 10 s from one visitor', origin: 'NL · datacentre ASN', hits: 74 },
  { id: 6, at: '5 h ago', reason: 'referrer spam', detail: 'Referrer on spam list: seo-boost-pro.top', origin: 'UA', hits: 37 },
  { id: 7, at: '9 h ago', reason: 'bot', detail: 'Scripted client, missing browser headers', origin: 'SG · datacentre ASN', hits: 58 },
  { id: 8, at: 'Yesterday', reason: 'verification agent', detail: 'TailwatchVerifier/1.0 install check', origin: 'TailWatch', hits: 4 },
];

// ---- Reports ----
export const reconciliation = {
  js: 1200,
  requests: 11000,
  parts: [
    { label: 'Humans (JS recorded)', value: 1200, bar: 'bg-teal-500' },
    { label: 'Bots', value: 6400, bar: 'bg-rose-500' },
    { label: 'Assets and retries', value: 2100, bar: 'bg-slate-400' },
    { label: 'Blocked or consent denied', value: 900, bar: 'bg-amber-500' },
    { label: 'Beacon loss', value: 400, bar: 'bg-violet-500' },
  ],
};