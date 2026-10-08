import { describe, expect, it } from 'vitest';
import { FLAG_FIRST_PAGEVIEW, FLAG_HASH_ROUTE, normalizeUrl, validate } from '../src/index';
import { BROWSER_UA, FIXTURE_RECEIVED_AT, FIXTURE_SITE } from '../fixtures/payloads';

/** STAGE-1 A4: hash-router sites keep their `#/route` fragment, nobody else does. */
describe('A4 hash routes', () => {
  it('drops the fragment without the flag (unchanged v1 behaviour)', () => {
    expect(normalizeUrl('https://a.com/app#/users/7')?.path).toBe('/app');
  });

  it('keeps a #/ or #!/ route with the flag, normalised like a path', () => {
    const n = (u: string) => normalizeUrl(u, undefined, true);
    expect(n('https://a.com/#/users/7/')).toEqual({ href: 'https://a.com/#/users/7', host: 'a.com', path: '/#/users/7' });
    expect(n('https://a.com/app/#!/x?tab=2')?.path).toBe('/app#!/x');
    expect(n('https://a.com/#/')?.path).toBe('/#/');
    expect(n('https://a.com/?utm_source=x#/a')?.href).toBe('https://a.com/?utm_source=x#/a');
  });

  it('with the flag, no fragment or a plain anchor is the root route (the router rewrites / to /#/)', () => {
    expect(normalizeUrl('https://a.com/', undefined, true)?.href).toBe('https://a.com/#/');
    expect(normalizeUrl('https://a.com/#/', undefined, true)?.href).toBe('https://a.com/#/');
    expect(normalizeUrl('https://a.com/docs#install', undefined, true)?.path).toBe('/docs#/');
  });

  it('the validator applies the flag to the stored path', () => {
    const host = FIXTURE_SITE.allowedHosts.find((h) => !h.startsWith('*'))!;
    const outcome = validate(
      new Headers({ 'user-agent': BROWSER_UA }),
      JSON.stringify({
        s: FIXTURE_SITE.publicKey, n: 'pageview', u: `https://${host}/#/settings/`, q: 1,
        t: FIXTURE_RECEIVED_AT - 100, v: 1, f: FLAG_FIRST_PAGEVIEW | FLAG_HASH_ROUTE,
      }),
      { receivedAt: FIXTURE_RECEIVED_AT, site: FIXTURE_SITE },
    );
    expect(outcome.kind).toBe('accept');
    if (outcome.kind === 'accept') {
      expect(outcome.event.path).toBe('/#/settings');
      expect(outcome.event.flags).toBe(3);
    }
  });
});
