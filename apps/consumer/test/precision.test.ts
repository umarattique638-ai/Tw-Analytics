import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FLAG_AUTOMATION, parseWire, checkWire } from '@tailwatch/contract';
import { FIXTURE_SITE } from '../../../packages/contract/fixtures/payloads';
import type { ValidatedEvent } from '@tailwatch/contract';
import {
  BOTS_YML_ENTRIES,
  REFERRER_SPAM_DOMAINS,
  headlessScore,
  matchBotsYml,
  precisionVerdict,
  referrerSpamDomain,
} from '../src/precision';
import { BOTS } from '../src/precision/lists/bots.generated';

/**
 * Stage 7 exit test, part 1 (PLAN Phase 2): "a labelled regression corpus exists and passes".
 * Every row runs through the REAL edge check (contract checkWire) and then the consumer's precision pass,
 * exactly the two places a hit can be dropped. Humans must be counted, bots dropped with a readable reason.
 */

interface Row {
  id: string;
  label: 'human' | 'bot';
  ua: string | null;
  headers: Record<string, string>;
  asn?: number;
  width?: number;
  flags?: number;
  referrer?: string;
  https?: boolean;
  expect?: string | null;
  note?: string;
}

const corpus = JSON.parse(readFileSync(new URL('./corpus/bots-corpus.json', import.meta.url), 'utf8')) as { rows: Row[] };
const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);

/** Where a row ends up: counted, or dropped at the edge / in the consumer with reason:detail. */
function judge(row: Row): { stage: 'counted' | 'edge' | 'consumer'; detail: string } {
  const headers = new Headers(row.headers);
  if (row.ua !== null) headers.set('user-agent', row.ua);
  const body = JSON.stringify({
    s: FIXTURE_SITE.publicKey, n: 'pageview', u: 'https://example.com/pricing', q: 1, t: NOW, v: 3,
    ...(row.width !== undefined ? { w: row.width } : { w: 1280 }),
    ...(row.flags !== undefined ? { f: row.flags } : {}),
    ...(row.referrer !== undefined ? { r: row.referrer } : {}),
  });
  const parsed = parseWire(body);
  if (!parsed.ok) throw new Error(`${row.id}: payload rejected`);
  const outcome = checkWire(headers, parsed, { receivedAt: NOW, site: FIXTURE_SITE, country: 'US', asn: row.asn ?? 64496, https: row.https ?? true });
  if (outcome.kind === 'drop') return { stage: 'edge', detail: `${outcome.reason}:${outcome.detail ?? ''}` };
  if (outcome.kind !== 'accept') throw new Error(`${row.id}: ${outcome.kind}`);
  const v = precisionVerdict(outcome.event);
  return v ? { stage: 'consumer', detail: `${v.reason}:${v.detail}` } : { stage: 'counted', detail: '' };
}

describe('labelled bot regression corpus', () => {
  const rows = corpus.rows;

  it('is big enough to mean something, and every id is unique', () => {
    expect(rows.filter((r) => r.label === 'human').length).toBeGreaterThanOrEqual(50);
    expect(rows.filter((r) => r.label === 'bot').length).toBeGreaterThanOrEqual(65);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });

  it.each(rows.filter((r) => r.label === 'human').map((r) => [r.id, r] as const))('human %s is counted', (_id, row) => {
    expect(judge(row)).toEqual({ stage: 'counted', detail: '' });
  });

  it.each(rows.filter((r) => r.label === 'bot').map((r) => [r.id, r] as const))('bot %s is dropped, with its reason', (_id, row) => {
    const j = judge(row);
    expect(j.stage).not.toBe('counted');
    // Attributable: a reason AND a detail, never a bare "bot".
    expect(j.detail).toMatch(/^(bot|referrer_spam):.+/);
    if (row.expect) expect(j.detail.includes(row.expect), `${j.detail} vs ${row.expect}`).toBe(true);
  });

  it('confusion matrix (printed for the record)', () => {
    const m = { tp: 0, fn: [] as string[], tn: 0, fp: [] as string[] };
    const where: Record<string, number> = {};
    for (const r of rows) {
      const j = judge(r);
      if (r.label === 'bot') {
        if (j.stage === 'counted') m.fn.push(r.id);
        else m.tp += 1;
        where[j.stage] = (where[j.stage] ?? 0) + 1;
      } else if (j.stage === 'counted') m.tn += 1;
      else m.fp.push(`${r.id} (${j.detail})`);
    }
    console.log(`corpus: ${m.tp} bots dropped (edge ${where.edge ?? 0}, consumer ${where.consumer ?? 0}), ${m.tn} humans counted, false positives ${m.fp.length}, misses ${m.fn.length}`);
    expect(m.fp).toEqual([]);
    expect(m.fn).toEqual([]);
  });
});

describe('bots.yml pass', () => {
  it('is the full upstream list: 843 entries, every one usable in JavaScript', () => {
    expect(BOTS_YML_ENTRIES).toBe(843);
    for (const b of BOTS) expect(() => new RegExp(b.regex, 'i')).not.toThrow();
    // PLAN 1: "843 regexes incl. 78 AI-crawler entries": AI categories as named upstream.
    expect(BOTS.filter((b) => b.category.startsWith('AI ')).length).toBeGreaterThanOrEqual(78);
  });

  it('names the bot, including device-detector $1 names', () => {
    expect(matchBotsYml('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')?.name).toBe('Googlebot');
    expect(matchBotsYml('Mozilla/5.0 (compatible; 360Spider-Image)')?.name).toBe('360Spider-Image');
    expect(matchBotsYml('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0.0.0 Safari/537.36')).toBeNull();
    expect(matchBotsYml(undefined)).toBeNull();
  });

  it('named bots win over the generic catch-alls, which still catch unknown bots', () => {
    expect(matchBotsYml('Mozilla/5.0 (compatible; bingbot/2.0)')?.name).toBe('BingBot');
    expect(matchBotsYml('Mozilla/5.0 (compatible; my-new-scraperbot/1.0)')).toMatchObject({ name: 'Generic Bot', weak: false });
    // The same catch-all on an otherwise normal browser UA is only a weak signal (Stage 7 review).
    expect(matchBotsYml('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 CorpSecurity/2.1')).toMatchObject({ name: 'Generic Bot', weak: true });
  });

  it('is fast enough for the Free plan CPU budget (a human UA, which matches nothing)', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
    matchBotsYml(ua);
    const started = performance.now();
    for (let i = 0; i < 1000; i += 1) matchBotsYml(ua);
    const perCallMs = (performance.now() - started) / 1000;
    console.log(`bots.yml pass: ${(perCallMs * 1000).toFixed(1)} µs per human UA (25-event batch: ${(perCallMs * 25).toFixed(2)} ms)`);
    expect(perCallMs).toBeLessThan(0.3);
  });
});

describe('referrer spam', () => {
  it('matches the domain and its subdomains, nothing else', () => {
    expect(REFERRER_SPAM_DOMAINS).toBeGreaterThan(2300);
    expect(referrerSpamDomain('https://semalt.com/')).toBe('semalt.com');
    expect(referrerSpamDomain('https://www.semalt.com/x')).toBe('semalt.com');
    expect(referrerSpamDomain('https://a.b.semalt.com/')).toBe('semalt.com');
    expect(referrerSpamDomain('https://notsemalt.com/')).toBeNull();
    expect(referrerSpamDomain('https://www.google.com/')).toBeNull();
    expect(referrerSpamDomain('not a url')).toBeNull();
    expect(referrerSpamDomain(undefined)).toBeNull();
  });
});

describe('headless scoring', () => {
  const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
  const real = { chUa: '"Chromium";v="141", "Google Chrome";v="141", "Not/A)Brand";v="24"', chPlatform: '"Windows"', chMobile: '?0', lang: true, https: true };

  it('UA-vs-hints contradictions count as ONE weak signal, however many fire (UA-switcher extensions)', () => {
    const spoofed = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15', hints: real };
    expect(headlessScore(spoofed).contradictions).toEqual(['ch_engine', 'ch_platform']);
    expect(precisionVerdict(spoofed as ValidatedEvent)).toBeNull();
    expect(precisionVerdict({ ...spoofed, hints: { ...real, lang: false } } as ValidatedEvent)).toEqual({ reason: 'bot', detail: 'headless:ch_engine+ch_platform+no_lang' });
  });

  it('a real Chrome scores nothing', () => {
    expect(headlessScore({ userAgent: chrome, width: 1280, hints: real })).toEqual({ strong: [], contradictions: [], weak: [] });
  });
  it('events from an older collector (no hints at all) are judged on what there is', () => {
    expect(headlessScore({ userAgent: chrome, width: 800 })).toEqual({ strong: [], contradictions: [], weak: [] });
    expect(precisionVerdict({ userAgent: chrome, width: 800 } as ValidatedEvent)).toBeNull();
  });
  it('the edge forwards the hints (STAGE-1 A6) and drops the automation flag itself', () => {
    const parsed = parseWire(JSON.stringify({ s: FIXTURE_SITE.publicKey, n: 'pageview', u: 'https://example.com/', q: 1, t: NOW, v: 3 }));
    if (!parsed.ok) throw new Error('parse');
    const headers = new Headers({ 'user-agent': chrome, 'accept-language': 'en', 'sec-ch-ua': real.chUa, 'sec-ch-ua-platform': '"Windows"', 'sec-ch-ua-mobile': '?0' });
    const out = checkWire(headers, parsed, { receivedAt: NOW, site: FIXTURE_SITE });
    expect(out.kind === 'accept' && out.event.hints).toEqual(real);
    const automated = parseWire(JSON.stringify({ s: FIXTURE_SITE.publicKey, n: 'pageview', u: 'https://example.com/', q: 1, t: NOW, v: 3, f: 1 | FLAG_AUTOMATION }));
    if (!automated.ok) throw new Error('parse');
    expect(checkWire(headers, automated, { receivedAt: NOW, site: FIXTURE_SITE })).toMatchObject({ kind: 'drop', reason: 'bot', detail: 'automation' });
  });
});
