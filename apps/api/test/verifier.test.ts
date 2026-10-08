import { describe, expect, it } from 'vitest';
import { edgeBotReason } from '@tailwatch/contract';
import { VERIFIER_USER_AGENT, cspAllows, findSnippets, runActiveCheck } from '../src/verifier';

const KEY = 'tw_pub_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const OLD = 'tw_pub_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const C = 'https://collector.test';
const site = {
  domain: 'example.com',
  allowedHosts: ['example.com', '*.example.com'],
  keys: [
    { publicKey: OLD, status: 'revoked' },
    { publicKey: KEY, status: 'active' },
  ],
};
const tag = (k = KEY) => `<script async src="${C}/tw.js?id=${k}"></script>`;

/** A fake web: url -> response. Records the User-Agent of every request. */
function web(pages: Record<string, { status?: number; body?: string; type?: string; headers?: Record<string, string> }>) {
  const agents: string[] = [];
  const fetchImpl = (async (input: URL | string, init?: RequestInit) => {
    agents.push(new Headers(init?.headers).get('user-agent') ?? '');
    const p = pages[String(input)];
    if (!p) throw new TypeError('fetch failed');
    return new Response(p.body ?? '', {
      status: p.status ?? 200,
      headers: { 'content-type': p.type ?? 'text/html', ...(p.headers ?? {}) },
    });
  }) as typeof fetch;
  return { fetchImpl, agents, resolve: async () => ['93.184.216.34'] };
}
const script = { [`${C}/tw.js?id=${KEY}`]: { body: 'tw', type: 'application/javascript' } };
const statuses = (r: { checks: { id: string; status: string }[] }) => Object.fromEntries(r.checks.map((c) => [c.id, c.status]));

describe('active verifier (BUILD-ORDER ⑤)', () => {
  it('a correct install passes every check, and the verifier is an edge bot (never counted)', async () => {
    const w = web({ 'https://example.com/': { body: `<html><head>${tag()}</head></html>` }, ...script });
    const r = await runActiveCheck(site, undefined, w);
    expect(r.ok).toBe(true);
    expect(statuses(r)).toEqual({ reach: 'pass', present: 'pass', noscript: 'pass', once: 'pass', id: 'pass', script: 'pass', csp: 'pass' });
    expect(new Set(w.agents)).toEqual(new Set([VERIFIER_USER_AGENT]));
    expect(edgeBotReason(VERIFIER_USER_AGENT)).toEqual({ reason: 'verification_agent', detail: 'install_check' });
  });

  it.each([
    ['unreachable', {}, 'reach', "couldn't reach example.com"],
    ['HTTP 503', { 'https://example.com/': { status: 503 } }, 'reach', 'HTTP 503'],
    ['no snippet', { 'https://example.com/': { body: '<html></html>' } }, 'present', 'purge it'],
    ['commented out', { 'https://example.com/': { body: `<!-- ${tag()} -->` } }, 'noscript', 'HTML comment'],
    ['in noscript', { 'https://example.com/': { body: `<noscript>${tag()}</noscript>` } }, 'noscript', '<noscript>'],
    ['twice', { 'https://example.com/': { body: tag() + tag() }, ...script }, 'once', '2 times'],
    ['other key', { 'https://example.com/': { body: tag('tw_pub_ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ') } }, 'id', 'different site key'],
    ['revoked key', { 'https://example.com/': { body: tag(OLD) } }, 'id', 'revoked'],
    ['script 404', { 'https://example.com/': { body: tag() }, [`${C}/tw.js?id=${KEY}`]: { status: 404, type: 'text/plain' } }, 'script', 'HTTP 404'],
    ['CSP script-src', { 'https://example.com/': { body: tag(), headers: { 'content-security-policy': "script-src 'self'" } }, ...script }, 'csp', 'script-src'],
    ['CSP connect-src', { 'https://example.com/': { body: tag(), headers: { 'content-security-policy': `script-src ${C}; connect-src 'self'` } }, ...script }, 'csp', 'connect-src'],
  ] as const)('%s -> the failing step says what to do', async (_name, pages, failing, message) => {
    const r = await runActiveCheck(site, undefined, web(pages as never));
    expect(r.ok).toBe(false);
    const check = r.checks.find((c) => c.id === failing)!;
    expect(check.status).toBe('fail');
    expect(check.message).toContain(message);
  });

  it('follows a redirect (example.com -> www.example.com)', async () => {
    const w = web({
      'https://example.com/': { status: 301, headers: { location: 'https://www.example.com/' } },
      'https://www.example.com/': { body: tag() },
      ...script,
    });
    expect((await runActiveCheck(site, undefined, w)).ok).toBe(true);
  });

  it('only checks the site\'s own hosts, and never a private address (SSRF)', async () => {
    await expect(runActiveCheck(site, 'https://evil.test/', web({}))).rejects.toThrow(/not one of this site's hosts/);
    const internal = { ...web({ 'https://example.com/': { body: tag() } }), resolve: async () => ['10.0.0.5'] };
    const r = await runActiveCheck(site, undefined, internal);
    expect(r.checks[0]!.message).toContain('private network address');
  });

  it('a snippet mentioned inside another script (JS comment / string) is not a snippet', () => {
    const html = `<script>/* example: <script async src="https://COLLECTOR/tw.js?id=tw_pub_..."><\\/script> */ var x = 1;</script>`;
    expect(findSnippets(html, 'https://example.com/')).toEqual([]);
    expect(findSnippets(html + tag(), 'https://example.com/')).toHaveLength(1);
  });

  it('finds data-id and data-api, relative src, and ignores other scripts', () => {
    const html = `<script src="/app.js"></script><script defer src="/tw.js" data-id="${KEY}" data-api="https://c.test/e"></script>`;
    expect(findSnippets(html, 'https://example.com/x')).toEqual([{ src: 'https://example.com/tw.js', key: KEY, api: 'https://c.test/e', hidden: null }]);
  });

  it('CSP source lists', () => {
    const page = 'https://example.com';
    expect(cspAllows([], 'script-src', `${C}/tw.js`, page)).toBe(true);
    expect(cspAllows(["default-src 'self' https:"], 'script-src', `${C}/tw.js`, page)).toBe(true);
    expect(cspAllows(['script-src *.test'], 'script-src', `${C}/tw.js`, page)).toBe(true);
    expect(cspAllows(["default-src 'none'"], 'connect-src', `${C}/e`, page)).toBe(false);
    expect(cspAllows(["script-src 'self'", 'script-src https://collector.test'], 'script-src', `${C}/tw.js`, page)).toBe(false);
  });
});
