import type { DropReason } from './outcome';


export const VERIFIER_UA = /^TailwatchVerifier\//;

export const UA_DENYLIST: readonly RegExp[] = [
  /^curl\//i, /^wget\//i, /^httpie\//i, /^postmanruntime\//i,
  /^python-requests/i, /^python-urllib/i, /^go-http-client/i, /^libwww-perl/i,
  /^node-fetch/i, /^axios\//i, /^scrapy/i,
  /headlesschrome/i, /phantomjs/i,
  /googlebot|bingbot|ahrefsbot|semrushbot|yandexbot|baiduspider|duckduckbot|applebot|gptbot|claudebot|ccbot|petalbot|dotbot|mj12bot/i,
];

export const DATACENTRE_ASNS: ReadonlySet<number> = new Set([
  14618, 16509, 
  8075,
  14061, 
  24940, 
  16276, 
  63949,
  20473, 
  396982, 
  45102,
]);

export interface BotVerdict { reason: Extract<DropReason, 'bot' | 'verification_agent'>; detail: string }

export function edgeBotReason(userAgent: string | null, asn?: number): BotVerdict | null {
  if (!userAgent) return { reason: 'bot', detail: 'missing_user_agent' };
  if (VERIFIER_UA.test(userAgent)) return { reason: 'verification_agent', detail: 'install_check' };
  if (UA_DENYLIST.some((re) => re.test(userAgent))) return { reason: 'bot', detail: 'ua_denylist' };
  if (asn !== undefined && DATACENTRE_ASNS.has(asn)) return { reason: 'bot', detail: `datacentre_asn:${asn}` };
  return null;
}