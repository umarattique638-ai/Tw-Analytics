import { snippetsFor } from '../../src/snippets';

/**
 * Adding a site is a full install (decision 25): start the setup, the customer's page carries the snippet,
 * every check passes, and only then is the site saved. These helpers play the customer's page for tests
 * that just need a site to exist.
 */

/** A fetch that serves, for any domain being set up, a page with that setup's snippet (and tw.js itself). */
export function fakeSiteFetch(entries: Map<string, string>, collectorUrl: string): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.pathname.endsWith('/tw.js')) return new Response('/* tw */', { headers: { 'content-type': 'application/javascript' } });
    for (const [name, raw] of entries) {
      if (!name.startsWith('setup:')) continue;
      const setup = JSON.parse(raw) as { domain: string; publicKey: string };
      if (url.hostname !== setup.domain && url.hostname !== `www.${setup.domain}`) continue;
      const tag = snippetsFor(collectorUrl, setup.publicKey).find((s) => s.group === 'script-tag')!.code;
      return new Response(`<!doctype html><html><head>${tag}</head><body>shop</body></html>`, { headers: { 'content-type': 'text/html' } });
    }
    return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
}

/** Verifier options for createApp that use the fake page above (the DNS answer is a public address). */
export const fakeVerifier = (entries: Map<string, string>, collectorUrl: string) => ({
  fetchImpl: fakeSiteFetch(entries, collectorUrl),
  resolve: async () => ['93.184.216.34'],
});

type Post = (path: string, json: unknown) => Promise<{ status: number; body: any }>;

/**
 * Start -> check: the site as the API saves it. A refused start is returned as is (status + body),
 * so tests of the refusals read the same.
 */
export async function addSite(post: Post, entries: Map<string, string>, domain: string, timezone: string) {
  const started = await post('/setup', { domain, timezone });
  if (started.status >= 300) return started;
  const checked = await post('/setup/verify', {});
  if (!checked.body?.site) throw new Error(`install check did not pass: ${JSON.stringify(checked.body)}`);
  return { status: 201, body: { site: checked.body.site, sync: { ok: true } } };
}
