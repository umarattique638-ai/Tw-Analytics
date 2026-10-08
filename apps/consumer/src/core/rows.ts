import { advanceSession } from '@tailwatch/contract';
import type { DropQueueMessage, EventQueueMessage, SessionState, ValidatedEvent } from '@tailwatch/contract';
import { parseUserAgent, referrerSource, utmFromUrl } from './enrich';

/** ClickHouse DateTime64(3, 'UTC') text form: 'YYYY-MM-DD HH:MM:SS.mmm'. */
export const chTime = (ms: number): string => new Date(ms).toISOString().replace('T', ' ').replace('Z', '');

/** Column names and order mirror infra/clickhouse/001_contract.sql (a test enforces it). */
export interface EventRow {
  site_id: number;
  insert_id: string;
  name: string;
  timestamp: string;
  received_at: string;
  is_backfill: number;
  hostname: string;
  pathname: string;
  route: string;
  referrer: string;
  referrer_source: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_term: string;
  utm_content: string;
  country_code: string;
  device: string;
  browser: string;
  browser_version: string;
  os: string;
  os_version: string;
  screen_width: number;
  visitor_hash: string;
  session_id: number;
  seq: number;
  engagement_ms: number;
  is_session_start: number;
  is_first_visit: number;
  tracker_version: number;
  props: Record<string, string>;
}

export interface SessionRow {
  site_id: number;
  session_id: number;
  visitor_hash: string;
  start: string;
  last_seen: string;
  entry_path: string;
  exit_path: string;
  referrer_source: string;
  utm_source: string;
  country_code: string;
  device: string;
  browser: string;
  os: string;
  pageviews: number;
  custom_events: number;
  engagement_ms: number;
  is_engaged: number;
  sign: 1 | -1;
  version: number;
}

export interface DroppedRow {
  site_id: number;
  at: string;
  reason: string;
  detail: string;
  country_code: string;
  asn: number;
  hits: number;
}

/** What the session store keeps per visitor: the metric state plus the descriptive columns. */
export interface SessionRecord {
  state: SessionState;
  entryPath: string;
  exitPath: string;
  referrerSource: string;
  utmSource: string;
  country: string;
  device: string;
  browser: string;
  os: string;
  /**
   * Stage 7 sessionisation hardening: set when the consumer dropped one of this visitor's hits as
   * referrer spam (only the first hit of a visit carries the referrer). Every later event of the same
   * visitor inside the session window is dropped with the same itemised reason, so the spam visit cannot
   * leak its follow-up events (engagement, SPA navigations) into the counts. Lives exactly as long as the
   * session record (30 min sliding).
   */
  quarantine?: { reason: string; detail: string };
}

export interface Enriched {
  ua: ReturnType<typeof parseUserAgent>;
  referrerSource: string;
  utm: ReturnType<typeof utmFromUrl>;
}

export function enrich(event: ValidatedEvent): Enriched {
  return {
    ua: parseUserAgent(event.userAgent),
    referrerSource: referrerSource(event.referrer, event.host),
    utm: utmFromUrl(event.url),
  };
}

export interface Advanced {
  record: SessionRecord;
  previous: SessionRecord | null;
  started: boolean;
  /** The visitor id the session (and its events) are stored under. */
  visitor: string;
}

/**
 * Applies one accepted event to a visitor's session record. The metric part is the
 * contract's advanceSession(); this adds the descriptive columns.
 */
export function advanceRecord(prev: SessionRecord | null, msg: EventQueueMessage): Advanced {
  const e = msg.event;
  const en = enrich(e);
  // A session found through yesterday's hash keeps yesterday's id, so a visit that
  // crosses UTC midnight is one visitor and one session (PLAN 5).
  const visitor =
    prev && (prev.state.visitor === msg.visitor.hash || prev.state.visitor === msg.visitor.prevHash)
      ? prev.state.visitor
      : msg.visitor.hash;
  const r = advanceSession(prev?.state ?? null, { visitor, t: e.occurredAt, name: e.name, engagementMs: e.engagementMs });
  const base = r.started || !prev ? null : prev;
  const record: SessionRecord = {
    state: r.next,
    entryPath: base?.entryPath ?? e.path,
    exitPath: e.name === 'pageview' ? e.path : (base?.exitPath ?? e.path),
    referrerSource: base?.referrerSource ?? en.referrerSource,
    utmSource: base?.utmSource ?? en.utm.source,
    country: base?.country ?? e.country ?? '',
    device: base?.device ?? en.ua.device,
    browser: base?.browser ?? en.ua.browser,
    os: base?.os ?? en.ua.os,
  };
  return { record, previous: r.started ? null : prev, started: r.started, visitor };
}

const propString = (v: string | number | boolean): string => String(v);

export function eventRow(msg: EventQueueMessage, session: { id: number; started: boolean; visitor: string }): EventRow {
  const e = msg.event;
  const en = enrich(e);
  const props: Record<string, string> = {};
  for (const [k, v] of Object.entries(e.props)) props[k] = propString(v);
  return {
    site_id: e.siteId,
    insert_id: e.insertId ?? '',
    name: e.name,
    timestamp: chTime(e.occurredAt),
    received_at: chTime(e.receivedAt),
    is_backfill: e.backfill ? 1 : 0,
    hostname: e.host,
    pathname: e.path,
    route: e.route ?? '',
    referrer: e.referrer ?? '',
    referrer_source: en.referrerSource,
    utm_source: en.utm.source,
    utm_medium: en.utm.medium,
    utm_campaign: en.utm.campaign,
    utm_term: en.utm.term,
    utm_content: en.utm.content,
    country_code: e.country ?? '',
    device: en.ua.device,
    browser: en.ua.browser,
    browser_version: en.ua.browserVersion,
    os: en.ua.os,
    os_version: en.ua.osVersion,
    screen_width: e.width ?? 0,
    visitor_hash: session.visitor,
    session_id: session.id,
    seq: e.seq,
    engagement_ms: e.engagementMs ?? 0,
    is_session_start: session.started ? 1 : 0,
    // Cannot be derived: visitor hashes rotate daily and there is no cookie. Open decision.
    is_first_visit: 0,
    tracker_version: e.trackerVersion,
    props,
  };
}

function sessionRow(r: SessionRecord, sign: 1 | -1): SessionRow {
  const s = r.state;
  return {
    site_id: 0, // filled by caller
    session_id: s.id,
    visitor_hash: s.visitor,
    start: chTime(s.start),
    last_seen: chTime(s.end),
    entry_path: r.entryPath,
    exit_path: r.exitPath,
    referrer_source: r.referrerSource,
    utm_source: r.utmSource,
    country_code: r.country,
    device: r.device,
    browser: r.browser,
    os: r.os,
    pageviews: s.pageviews,
    custom_events: s.customEvents,
    engagement_ms: s.engagementMs,
    is_engaged: s.engaged ? 1 : 0,
    sign,
    version: s.version,
  };
}

/**
 * VersionedCollapsingMergeTree rows for one state change: a copy of the old row
 * with sign -1 and the SAME version cancels it, and the new row (+1, version + 1)
 * replaces it. A brand-new session has nothing to cancel.
 */
export function sessionRows(siteId: number, previous: SessionRecord | null, next: SessionRecord): SessionRow[] {
  const rows: SessionRow[] = [];
  if (previous) rows.push({ ...sessionRow(previous, -1), site_id: siteId });
  rows.push({ ...sessionRow(next, 1), site_id: siteId });
  return rows;
}

export function droppedRow(msg: DropQueueMessage): DroppedRow {
  return {
    site_id: msg.siteId,
    at: chTime(msg.at),
    reason: msg.reason,
    detail: msg.detail ?? '',
    country_code: msg.country ?? '',
    asn: msg.asn ?? 0,
    hits: 1,
  };
}