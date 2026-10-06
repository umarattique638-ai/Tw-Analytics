export const LIMITS = {
  /**
   * Maximum raw request body accepted by the collector.
   *
   * The collector must check this before parsing JSON.
   */
  maxBodyBytes: 32 * 1024,

  /** Maximum normalized URL length. */
  maxUrlLength: 2048,

  /** Maximum referrer length. */
  maxReferrerLength: 2048,

  /** Maximum SPA/framework route template length. */
  maxRouteLength: 256,

  /** Maximum client-generated idempotency key length. */
  maxInsertIdLength: 64,

  /** Maximum User-Agent length retained for enrichment. */
  maxUserAgentLength: 512,

  /** Maximum viewport width accepted from the browser. */
  maxScreenWidth: 100_000,

  /** Maximum tracker version value. */
  maxVersion: 65_535,

  maxSequence: 4_294_967_295,

  /** Maximum compact flags value. */
  maxFlags: 255,

  /** Maximum engagement time accepted for one event. */
  maxEngagementMs: 24 * 60 * 60 * 1000,

  /** Maximum custom properties per event. */
  maxProps: 25,

  /** Maximum custom property key length. */
  maxPropKeyLength: 40,

  /** Maximum custom property value length. */
  maxPropValueLength: 255,

  /** Maximum diagnostic/drop detail length. */
  maxDropDetailLength: 200,

  /**
   * Events older than this are marked as backfill.
   *
   * Events older than this are accepted and flagged as backfill; they are
   * never silently rewritten to receivedAt.
   */
  backfillAfterMs: 72 * 60 * 60 * 1000,



  /** Maximum tolerated future client clock skew. */
  maxFutureSkewMs: 5 * 60 * 1000,

  /** Session inactivity timeout. */
  sessionGapMs: 30 * 60 * 1000,

  /**
   * Engagement threshold.
   *
   * IMPORTANT:
   * A session is engaged only when engagementMs > this value.
   * Exactly 10 seconds is NOT engaged.
   */
  engagedMinMs: 10_000,
} as const;

/**
 * Event names are deliberately restrictive so they remain
 * safe and predictable across ClickHouse, APIs and dashboards.
 */
export const EVENT_NAME_RE = /^[a-z0-9_]{1,40}$/;

/**
 * Public browser site key format.
 *
 * tw_pub_ + exactly 32 alphanumeric characters.
 */
export const SITE_KEY_RE = /^tw_pub_[A-Za-z0-9]{32}$/;

/**
 * Object prototype keys that must never be accepted as
 * custom property names.
 */
export const UNSAFE_PROP_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

/**
 * Reserved namespace for TailWatch-owned event names.
 */
export const RESERVED_NAME_PREFIX = 'tw_';

/**
 * Event names automatically generated/owned by TailWatch.
 *
 * These names must not be treated as arbitrary custom events.
 */
export const AUTOMATIC_EVENTS: ReadonlySet<string> = new Set([
  'pageview',
  'session_start',
  'first_visit',
  'engagement',

  'scroll',
  'outbound_click',
  'file_download',
  'site_search',
  'form_start',
  'form_submit',

  'video_start',
  'video_progress',
  'video_complete',

  'rage_click',
  'dead_click',
  'js_error',
  'web_vitals',
]);

/**
 * ASCII control characters.
 *
 * Used for sanitizing strings before they are persisted/logged.
 */
const CONTROL_CHARS_RE = /[\x00-\x1F\x7F]/g;

/**
 * Removes ASCII control characters from a string.
 */
export const stripControlChars = (value: string): string =>
  value.replace(CONTROL_CHARS_RE, '');