import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { guardedFetch, isPublicAddress } from '../src/netguard';
import { runActiveCheck } from '../src/verifier';

/** SSRF guard of the install verifier: every special address form is refused, real sites are not. */
describe('isPublicAddress', () => {
  const blocked = [
    // IPv4
    '0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '127.255.255.254', '169.254.169.254', '172.16.0.1', '172.31.255.255',
    '192.0.0.8', '192.0.2.1', '192.88.99.1', '192.168.1.1', '198.18.0.1', '198.19.255.255', '198.51.100.7', '203.0.113.9',
    '224.0.0.1', '239.255.255.250', '240.0.0.1', '255.255.255.255',
    // IPv6 and every form that embeds IPv4
    '::', '::1', '[::1]', 'fe80::1', 'fe80::1%eth0', 'fc00::1', 'fd12:3456::1', 'fec0::1', 'ff02::1', '2001:db8::1', '100::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '::ffff:10.0.0.1', '0:0:0:0:0:ffff:c0a8:101',
    '::127.0.0.1', '::7f00:1', '64:ff9b::7f00:1', '64:ff9b::a9fe:a9fe', '2002:7f00:1::', '2002:a9fe:a9fe::1', '2001::1',
    // junk
    'localhost', '', '1.2.3', '1.2.3.4.5', '256.1.1.1', '::g', '1:2:3:4:5:6:7:8:9',
  ];
  const open = ['93.184.216.34', '1.1.1.1', '8.8.8.8', '104.16.0.1', '2606:4700::6810:84e5', '2a00:1450:4001:82a::200e', '::ffff:93.184.216.34', '64:ff9b::808:808', '2002:5db8:d822::1'];

  it.each(blocked)('refuses %s', (a) => expect(isPublicAddress(a)).toBe(false));
  it.each(open)('allows %s', (a) => expect(isPublicAddress(a)).toBe(true));
});

describe('guardedFetch never connects to a private address', () => {
  let port = 0;
  let hits = 0;
  const server = createServer((req, res) => {
    hits += 1;
    if (req.url === '/205') {
      res.writeHead(205);
      return res.end();
    }
    if (req.url === '/999') {
      res.writeHead(999);
      return res.end('x');
    }
    res.end('secret');
  });
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise((r) => server.close(r)));

  it('literal private IPs, odd ports and names that resolve to loopback are all refused before any byte is sent', async () => {
    await expect(guardedFetch('http://127.0.0.1/')).rejects.toThrow('private address');
    await expect(guardedFetch('http://[::ffff:7f00:1]/')).rejects.toThrow('private address');
    await expect(guardedFetch(`http://127.0.0.1:${port}/`)).rejects.toThrow('private address'); // port not allowed either
    await expect(guardedFetch('http://localhost/')).rejects.toThrow(); // resolves to loopback: refused at connect time
    await expect(guardedFetch('file:///etc/passwd')).rejects.toThrow('bad protocol');
    expect(hits).toBe(0);
  });

  it('the allowed path streams the answer back as a normal Response (status, headers, body)', async () => {
    const r = await guardedFetch(`http://localhost:${port}/x`, { headers: { 'user-agent': 't' } }, { allowed: () => true, ports: new Set([String(port)]) });
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('secret');
    expect(hits).toBe(1);
  });

  it('odd statuses from a hostile server reject the promise instead of crashing the process', async () => {
    const open = { allowed: () => true, ports: new Set([String(port)]) };
    expect((await guardedFetch(`http://localhost:${port}/205`, {}, open)).status).toBe(205);
    await expect(guardedFetch(`http://localhost:${port}/999`, {}, open)).rejects.toThrow('bad status 999');
  });
});

describe('the verifier itself', () => {
  const site = { domain: 'shop.example.com', allowedHosts: ['shop.example.com', '*.shop.example.com'], keys: [{ publicKey: 'tw_pub_x', status: 'active' }] };

  it('a page that redirects to an IPv4-mapped loopback address is reported, never fetched', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (u: URL | string) => {
      seen.push(String(u));
      return new Response('', { status: 302, headers: { location: 'http://[::ffff:7f00:1]/admin' } });
    }) as typeof fetch;
    const r = await runActiveCheck(site, 'https://shop.example.com/', { fetchImpl, resolve: async () => ['93.184.216.34'] });
    expect(r.checks[0]).toMatchObject({ id: 'reach', status: 'fail' });
    expect(r.checks[0]!.message).toContain('private network address');
    expect(seen).toEqual(['https://shop.example.com/']);
  });

  it('a script URL on a metadata address is not fetched', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (u: URL | string) => {
      seen.push(String(u));
      return new Response('<script async src="http://[::ffff:a9fe:a9fe]/tw.js?id=tw_pub_x"></script>', { status: 200, headers: { 'content-type': 'text/html' } });
    }) as typeof fetch;
    const r = await runActiveCheck(site, 'https://shop.example.com/', { fetchImpl, resolve: async () => ['93.184.216.34'] });
    expect(r.checks.find((c) => c.id === 'script')).toMatchObject({ status: 'fail' });
    expect(seen).toEqual(['https://shop.example.com/']);
  });

  it('a site on an unusual port is refused with a clear reason', async () => {
    const r = await runActiveCheck({ ...site }, 'https://shop.example.com:6379/', { fetchImpl: (async () => new Response('')) as unknown as typeof fetch, resolve: async () => ['93.184.216.34'] });
    expect(r.checks[0]!.message).toContain('only ports 80, 443, 8080 and 8443');
  });
});
