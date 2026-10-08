import type { DropReason } from './outcome';
import { DATACENTRE_ASN_LIST } from './lists/datacentre-asns.generated';

/**
 * EDGE bot checks (PLAN 2.4): cheap and unambiguous only, single-digit ms. Everything debatable
 * (the full 843-regex bots.yml pass, headless scoring, referrer spam) is decided in the consumer,
 * where it is itemised with its reason (apps/consumer/src/precision).
 */

export const VERIFIER_UA = /^TailwatchVerifier\//;

export const UA_DENYLIST: readonly RegExp[] = [
  /^curl\//i, /^wget\//i, /^httpie\//i, /^postmanruntime\//i,
  /^python-requests/i, /^python-urllib/i, /^go-http-client/i, /^libwww-perl/i,
  /^node-fetch/i, /^axios\//i, /^scrapy/i,
  // Default User-Agents of server runtimes and HTTP libraries (no browser sends these).
  /^undici/i, /^node$/i, /^deno\//i, /^bun\//i, /^okhttp\//i, /^java\//i, /^apache-httpclient\//i,
  /headlesschrome/i, /phantomjs/i,
  /googlebot|bingbot|ahrefsbot|semrushbot|yandexbot|baiduspider|duckduckbot|applebot|gptbot|claudebot|ccbot|petalbot|dotbot|mj12bot/i,
];

/**
 * Datacentre / hosting ASNs (Stage 7): brianhama/bad-asn-list (MIT) + our additions, minus our
 * never-drop list (iCloud Private Relay, WARP, corporate gateways, residential ISPs the upstream lists).
 * Source and review process: infra/lists/SOURCES.md. O(1) per request.
 */
export const DATACENTRE_ASNS: ReadonlySet<number> = new Set(DATACENTRE_ASN_LIST);

export interface BotVerdict { reason: Extract<DropReason, 'bot' | 'verification_agent'>; detail: string }

export function edgeBotReason(userAgent: string | null, asn?: number): BotVerdict | null {
  if (!userAgent) return { reason: 'bot', detail: 'missing_user_agent' };
  if (VERIFIER_UA.test(userAgent)) return { reason: 'verification_agent', detail: 'install_check' };
  if (UA_DENYLIST.some((re) => re.test(userAgent))) return { reason: 'bot', detail: 'ua_denylist' };
  if (asn !== undefined && DATACENTRE_ASNS.has(asn)) return { reason: 'bot', detail: `datacentre_asn:${asn}` };
  return null;
}
