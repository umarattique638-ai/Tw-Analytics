import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DropQueueMessage, EventQueueMessage, ValidatedEvent } from '@tailwatch/contract';
import { batchToken } from '../src/core/batch';
import { parseUserAgent, referrerSource, utmFromUrl } from '../src/core/enrich';
import { advanceRecord, chTime, droppedRow, eventRow, sessionRows } from '../src/core/rows';
import type { SessionRecord } from '../src/core/rows';

const T = Date.UTC(2026, 9, 1, 12, 0, 0);
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function msg(over: Partial<ValidatedEvent> = {}, visitor = { hash: '111', prevHash: '100' }): EventQueueMessage {
  const event: ValidatedEvent = {
    siteId: 7, name: 'pageview', url: 'https://example.com/a?utm_source=news&utm_medium=email', host: 'example.com', path: '/a',
    referrer: 'https://www.google.com/search?q=x', seq: 1, createdAt: T, occurredAt: T, receivedAt: T + 50, backfill: false,
    trackerVersion: 1, flags: 0, props: { plan: 'pro', n: 3, ok: true }, warnings: [], extra: {}, userAgent: CHROME, country: 'IN', ...over,
  };
  return { v: 1, type: 'event', event, visitor };
}

/** Column names declared inside CREATE TABLE tailwatch.<table> ( ... ) ENGINE in the DDL file. */
function ddlColumns(table: string): string[] {
  const sql = readFileSync(new URL('../../../infra/clickhouse/001_contract.sql', import.meta.url), 'utf8');
  const m = sql.match(new RegExp(`CREATE TABLE IF NOT EXISTS tailwatch\\.${table}\\s*\\(([\\s\\S]*?)\\)\\s*ENGINE`));
  if (!m) throw new Error(`table ${table} not found in DDL`);
  return m[1]!.split('\n').map((l) => l.trim().match(/^([a-z_]+)\s+\S/)?.[1]).filter((x): x is string => !!x);
}

describe('rows match the ClickHouse DDL exactly', () => {
  it('events', () => {
    const row = eventRow(msg(), { id: 1, started: true, visitor: '111' });
    expect(Object.keys(row).sort()).toEqual(ddlColumns('events').sort());
  });
  it('sessions', () => {
    const a = advanceRecord(null, msg());
    const [row] = sessionRows(7, null, a.record);
    expect(Object.keys(row!).sort()).toEqual(ddlColumns('sessions').sort());
  });
  it('dropped_hits', () => {
    const d: DropQueueMessage = { v: 1, type: 'drop', at: T, siteId: 7, reason: 'bot' };
    expect(Object.keys(droppedRow(d)).sort()).toEqual(ddlColumns('dropped_hits').sort());
  });
});

describe('event rows', () => {
  it('maps and stringifies every field, with no IP anywhere', () => {
    const row = eventRow(msg(), { id: 42, started: true, visitor: '111' });
    expect(row).toMatchObject({
      site_id: 7, name: 'pageview', hostname: 'example.com', pathname: '/a', country_code: 'IN', visitor_hash: '111', session_id: 42,
      is_session_start: 1, is_backfill: 0, referrer_source: 'google.com', utm_source: 'news', utm_medium: 'email', browser: 'Chrome',
      browser_version: '126', os: 'Windows', device: 'desktop', props: { plan: 'pro', n: '3', ok: 'true' },
    });
    expect(row.timestamp).toBe('2026-10-01 12:00:00.000');
    expect(JSON.stringify(row)).not.toMatch(/203\.0\.113/);
  });
});

describe('session rows (VersionedCollapsingMergeTree)', () => {
  it('a new session writes one +1 row at version 1', () => {
    const a = advanceRecord(null, msg());
    const rows = sessionRows(7, a.previous, a.record);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sign: 1, version: 1, pageviews: 1, entry_path: '/a', exit_path: '/a' });
  });

  it('a continued session cancels the old row (same version, -1) and writes the new one (+1, version + 1)', () => {
    const a = advanceRecord(null, msg());
    const b = advanceRecord(a.record, msg({ path: '/b', url: 'https://example.com/b', seq: 2, occurredAt: T + 60_000 }));
    const rows = sessionRows(7, b.previous, b.record);
    expect(rows).toHaveLength(2);
    const [cancel, add] = rows as [typeof rows[0], typeof rows[0]];
    expect(cancel).toMatchObject({ sign: -1, version: 1, pageviews: 1, exit_path: '/a' });
    expect(add).toMatchObject({ sign: 1, version: 2, pageviews: 2, entry_path: '/a', exit_path: '/b', is_engaged: 1 });
    // the cancel row must equal the originally inserted +1 row apart from sign
    const original = sessionRows(7, null, a.record)[0]!;
    expect({ ...cancel, sign: 1 }).toEqual(original);
  });

  it('after the 30 minute gap a new session starts at version 1 with nothing to cancel', () => {
    const a = advanceRecord(null, msg());
    const b = advanceRecord(a.record, msg({ seq: 2, occurredAt: T + 30 * 60_000 + 1 }));
    expect(b.started).toBe(true);
    expect(sessionRows(7, b.previous, b.record)).toHaveLength(1);
    expect(b.record.state.version).toBe(1);
  });

  it('a session crossing UTC midnight keeps yesterday\'s visitor id', () => {
    const late = Date.UTC(2026, 9, 1, 23, 55, 0);
    const a = advanceRecord(null, msg({ occurredAt: late, receivedAt: late }, { hash: 'DAY1', prevHash: 'DAY0' }));
    const b = advanceRecord(a.record, msg({ seq: 2, occurredAt: late + 600_000, receivedAt: late + 600_000 }, { hash: 'DAY2', prevHash: 'DAY1' }));
    expect(b.started).toBe(false);
    expect(b.visitor).toBe('DAY1');
    expect(b.record.state.id).toBe(a.record.state.id);
    expect(eventRow(msg(), { id: b.record.state.id, started: false, visitor: b.visitor }).visitor_hash).toBe('DAY1');
  });

  it('a different visitor never continues someone else\'s session', () => {
    const a = advanceRecord(null, msg());
    const b = advanceRecord(a.record, msg({ seq: 2, occurredAt: T + 1000 }, { hash: '999', prevHash: '998' }));
    expect(b.started).toBe(true);
  });

  it('descriptive columns are fixed at session start and exit_path follows pageviews only', () => {
    const a = advanceRecord(null, msg());
    const b = advanceRecord(a.record, msg({ name: 'signup', path: '/thanks', seq: 2, occurredAt: T + 1000, referrer: undefined }));
    const r = b.record as SessionRecord;
    expect(r.referrerSource).toBe('google.com');
    expect(r.exitPath).toBe('/a');
    expect(r.state.customEvents).toBe(1);
  });
});

describe('enrichment', () => {
  it('parses the common browsers and keeps Chromium forks apart', () => {
    expect(parseUserAgent(CHROME)).toMatchObject({ browser: 'Chrome', os: 'Windows', device: 'desktop' });
    expect(parseUserAgent(`${CHROME} Edg/126.0.2592.81`).browser).toBe('Edge');
    expect(parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'))
      .toMatchObject({ browser: 'Safari', os: 'iOS', osVersion: '17.5', device: 'mobile' });
    expect(parseUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36'))
      .toMatchObject({ browser: 'Chrome', os: 'Android', device: 'mobile' });
    expect(parseUserAgent(undefined)).toMatchObject({ browser: '', os: '', device: 'desktop' });
  });
  it('referrer source drops www, direct and self-referrals', () => {
    expect(referrerSource('https://www.google.com/x', 'example.com')).toBe('google.com');
    expect(referrerSource('https://blog.example.com/', 'www.example.com')).toBe('');
    expect(referrerSource(undefined, 'example.com')).toBe('');
    expect(referrerSource('not a url', 'example.com')).toBe('');
  });
  it('reads utm values from the normalised url', () => {
    expect(utmFromUrl('https://example.com/?utm_campaign=c&utm_term=t')).toMatchObject({ campaign: 'c', term: 't', source: '' });
  });
});

describe('batch token and drop rows', () => {
  it('is stable across redelivery and order, and changes with the batch', async () => {
    expect(await batchToken(['a', 'b', 'c'])).toBe(await batchToken(['c', 'a', 'b']));
    expect(await batchToken(['a', 'b'])).not.toBe(await batchToken(['a', 'b', 'c']));
    expect(await batchToken(['a'])).toMatch(/^[0-9a-f]{64}$/);
  });
  it('drop rows carry the reason and one hit', () => {
    expect(droppedRow({ v: 1, type: 'drop', at: T, siteId: 7, reason: 'gpc', country: 'IN', asn: 55836 })).toMatchObject({ reason: 'gpc', hits: 1, asn: 55836 });
    expect(chTime(0)).toBe('1970-01-01 00:00:00.000');
  });
});