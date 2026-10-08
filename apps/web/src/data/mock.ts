import type { CheckItem, DayPoint, InstallMethod, Row, Warning } from '../types';

export const site = { domain: 'example.com', timezone: 'Asia/Karachi', range: 'Last 7 days' };
export const publicKey = 'tw_pub_a1b2c3d4e5f6a7b8';

export const series: DayPoint[] = [
  { day: 'Sep 24', views: 812, visitors: 540 }, { day: 'Sep 25', views: 934, visitors: 611 },
  { day: 'Sep 26', views: 1120, visitors: 702 }, { day: 'Sep 27', views: 688, visitors: 455 },
  { day: 'Sep 28', views: 590, visitors: 401 }, { day: 'Sep 29', views: 1043, visitors: 668 },
  { day: 'Sep 30', views: 1287, visitors: 790 },
];
export const pages: Row[] = [
  { label: '/', value: 2310 }, { label: '/blog/[slug]', value: 1874 }, { label: '/pricing', value: 962 },
  { label: '/docs/install', value: 641 }, { label: '/about', value: 287 },
];
export const referrers: Row[] = [
  { label: 'Direct / none', value: 1980 }, { label: 'google.com', value: 1422 },
  { label: 'news.ycombinator.com', value: 610 }, { label: 'x.com', value: 388 }, { label: 'github.com', value: 205 },
];
export const countries: Row[] = [
  { label: 'Pakistan', value: 1730 }, { label: 'United States', value: 1216 }, { label: 'United Kingdom', value: 704 },
  { label: 'Germany', value: 522 }, { label: 'India', value: 398 },
];
export const capture = { received: 1284, expected: 1405 };
export const warnings: Warning[] = [
  { reason: 'bot', detail: 'Headless browser from a datacentre network', count: 312, last: '4 min ago' },
  { reason: 'hostname', detail: 'Hits from staging.example.io, not in your allowed hosts', count: 18, last: '2 h ago' },
  { reason: 'verification agent', detail: 'TailwatchVerifier/1.0 install checks', count: 4, last: 'Yesterday' },
];
export const allowedHosts = ['example.com', 'www.example.com', '*.example.com'];
export const timezones = ['Asia/Karachi', 'UTC', 'Europe/London', 'America/New_York'];

export const snippets: Record<InstallMethod, string> = {
  'script-tag': `<script async fetchpriority="low"\n  src="https://cdn.tailwatch.com/tw.js?id=${publicKey}"></script>`,
  npm: `npm i @tailwatch/browser\n\nimport { init } from '@tailwatch/browser'\ninit({ site: '${publicKey}' })`,
  framework: `npm i @tailwatch/next\n\nimport { TailwatchProvider } from '@tailwatch/next'\n<TailwatchProvider site="${publicKey}" />`,
  wordpress: `1. Install the "TailWatch Analytics" plugin\n2. Paste your site key: ${publicKey}\n3. Select Connect`,
};
export const installTabs: { id: InstallMethod; label: string }[] = [
  { id: 'script-tag', label: 'Script tag' }, { id: 'npm', label: 'npm package' },
  { id: 'framework', label: 'Framework' }, { id: 'wordpress', label: 'WordPress' },
];
export const checks: CheckItem[] = [
  { id: 'reach', label: 'Site reachable', failHint: "We couldn't reach the site (timeout)." },
  { id: 'present', label: 'Snippet in page source', failHint: 'If you use a cache, purge it.' },
  { id: 'id', label: 'Site key matches', failHint: 'The snippet uses a different site key.' },
  { id: 'script', label: 'Script loads', failHint: 'Check your CSP script-src.' },
  { id: 'noscript', label: 'Not in noscript or a comment', failHint: 'Move it into <head>.' },
  { id: 'once', label: 'Only one snippet', failHint: 'Remove the duplicate.' },
];
