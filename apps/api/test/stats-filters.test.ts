import { describe, expect, it } from 'vitest';
import { FILTERABLE, QUERIES, filtered } from '../src/stats';
import type { QueryName } from '../src/stats';

/** Decision 30: overview filters add conditions as parameters; the SQL itself ran on chDB while building. */
describe('overview filters', () => {
  it('no filter: every query is exactly the documented one', () => {
    for (const name of Object.keys(QUERIES) as QueryName[]) expect(filtered(name, {})).toEqual({ sql: QUERIES[name], params: {} });
    expect(filtered('visitors_pageviews', { page: '' })).toEqual({ sql: QUERIES.visitors_pageviews, params: {} });
  });

  it('capture rate, warnings and live numbers are never filtered', () => {
    for (const name of ['capture_rate', 'drops_by_reason', 'live_active', 'live_events'] as QueryName[]) {
      expect(FILTERABLE[name]).toBeUndefined();
      expect(filtered(name, { page: '/pricing' }).sql).toBe(QUERIES[name]);
    }
  });

  it('events: the hits on that page; sessions: the visits that viewed it', () => {
    const ev = filtered('visitors_pageviews', { page: '/pricing' });
    expect(ev.sql).toContain('AND pathname = {f_page:String}');
    expect(ev.params).toEqual({ f_page: '/pricing' });
    const se = filtered('sessions_bounce', { page: '/pricing' });
    expect(se.sql).toContain("session_id IN (SELECT session_id FROM {db}.events WHERE site_id = {site:UInt64}");
    expect(se.sql).toContain("AND name = 'pageview' AND pathname = {f_page:String})");
  });

  it('several filters: all of them; a value is a parameter, never SQL', () => {
    const evil = "x' OR 1=1 --";
    const q = filtered('countries', { country: 'PK', browser: evil, source: 'news.ycombinator.com' });
    expect(q.sql).toContain('AND country_code = {f_country:String} AND');
    expect(q.sql).toContain('referrer_source = {f_source:String})');
    expect(q.sql).toContain('AND browser = {f_browser:String}');
    expect(q.sql).not.toContain(evil);
    expect(q.params).toEqual({ f_country: 'PK', f_browser: evil, f_source: 'news.ycombinator.com' });
  });
});
