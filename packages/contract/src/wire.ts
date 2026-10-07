import type { PropValue } from './types';

/**
 * Frozen browser -> collector wire contract version.
 */
export const WIRE_VERSION = 1 as const;

/**
 * Bit flags carried in `f`.
 *
 * FLAG_FIRST_PAGEVIEW: the first pageview this tracker instance emitted on this page load.
 * It is NOT "first visit ever" (that cannot be known without client storage, see STAGE-1 D7).
 */
export const FLAG_FIRST_PAGEVIEW = 1;

/**
 * Compact browser event payload, wire v1 (FROZEN 2026-10-07, append-only from here on).
 *
 * Required:
 *   s  = site public key (tw_pub_ + 32 alphanumerics). Body or query string, never a header.
 *   n  = event name, [a-z0-9_]{1,40}
 *   u  = page URL (absolute http/https, <= 2048)
 *   q  = per-page-load sequence number, starts at 1 (capture-rate signal)
 *   t  = client CREATED time, unix ms
 *   v  = tracker version (PLAN 4 invariant 9: sent on every hit)
 *
 * Optional:
 *   r  = referrer (query, fragment and credentials are stripped server-side)
 *   e  = engaged (visible AND focused) milliseconds since the previous event
 *   rt = route template, e.g. /blog/[slug]
 *   w  = viewport width in CSS px
 *   i  = insert id (client idempotency key, <= 64 chars). Duplicates within 7 days are dropped
 *        by the consumer (STAGE-1 D5).
 *   x  = client SENT time, unix ms. With `t` it gives the clock-skew correction
 *        occurred = received - (x - t)   (PLAN 8.2).
 *   f  = flags bitmask, see FLAG_*
 *   p  = custom properties, <= 25 keys, key <= 40 chars, value string(<=255)|number|boolean
 *
 * Unknown future fields are accepted and kept in `extra` (invariant 7: the client may be a
 * cached script we cannot update). Never rename, re-type or tighten an existing field.
 */
export interface WirePayload {
  s: string;
  n: string;
  u: string;
  q: number;
  t: number;
  v: number;

  r?: string;
  e?: number;
  rt?: string;
  w?: number;
  i?: string;
  x?: number;
  f?: number;
  p?: Record<string, PropValue>;

  [futureField: string]: unknown;
}

/**
 * Frozen list of known v1 fields.
 */
export const WIRE_FIELDS = [
  's',
  'n',
  'u',
  'q',
  't',
  'v',
  'r',
  'e',
  'rt',
  'w',
  'i',
  'x',
  'f',
  'p',
] as const;

export type WireField = (typeof WIRE_FIELDS)[number];

/** Fields a GET /e.gif pixel may carry as query parameters (everything except the `p` object). */
export const PIXEL_FIELDS = ['s', 'n', 'u', 'q', 't', 'v', 'r', 'e', 'rt', 'w', 'i', 'x', 'f'] as const;

/** Pixel fields that are numbers on the wire (query strings are text and are converted). */
export const PIXEL_NUMERIC_FIELDS = ['q', 't', 'v', 'e', 'w', 'x', 'f'] as const;

/**
 * Checks whether a field belongs to the currently known
 * v1 wire contract.
 *
 * Unknown fields are still allowed by WirePayload.
 */
export function isKnownWireField(field: string): field is WireField {
  return (WIRE_FIELDS as readonly string[]).includes(field);
}
