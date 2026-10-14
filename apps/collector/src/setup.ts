import type { SiteConfig, ValidatedEvent } from '@tailwatch/contract';
import type { Env } from './env';
import { log } from './log';

/** Same lifetime as the API's setup entries (apps/api/src/services/setup.ts). */
const SEEN_TTL_SECONDS = 7 * 86_400;

/**
 * A site being set up (decision 25) stores nothing: no event and no drop is queued for it. The only trace
 * is one KV note, `seen:<key>`, when its first real pageview arrives (it passed the host and bot checks
 * like any hit). The API's install check reads that note; it expires by itself.
 */
export async function noteSetupPageview(env: Env, site: SiteConfig, event: ValidatedEvent): Promise<void> {
  if (event.name !== 'pageview' || !env.SITE_CONFIG.put) return;
  const name = `seen:${site.publicKey}`;
  try {
    if (await env.SITE_CONFIG.get(name)) return; // already noted: one write per setup
    await env.SITE_CONFIG.put(name, JSON.stringify({ at: new Date(event.receivedAt).toISOString(), path: event.path }), { expirationTtl: SEEN_TTL_SECONDS });
  } catch (error) {
    log('setup_note_failed', error);
  }
}
