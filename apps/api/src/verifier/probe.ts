import { fetchLimited } from './fetch';
import type { VerifierOptions } from './types';

/**
 * Is anything answering at this domain? Asked before a setup starts (decision 25), so a typo or an
 * invented domain is refused at once instead of being set up. Any HTTP answer counts (even 403 or 404:
 * the site exists); only "nothing answers" fails. https first, then http.
 */
export async function probeDomain(domain: string, o: VerifierOptions = {}): Promise<{ ok: true } | { ok: false; why: string }> {
  let why = 'connection failed';
  for (const scheme of ['https', 'http']) {
    try {
      const got = await fetchLimited(`${scheme}://${domain}/`, o, 'text/html,*/*;q=0.5');
      await got.res.body?.cancel().catch(() => undefined);
      return { ok: true };
    } catch (error) {
      const e = error instanceof Error ? error : null;
      if (e?.name === 'TimeoutError') why = 'no answer within 10 seconds';
      else if (e?.message === 'private address') return { ok: false, why: 'it points to a private network address' };
      else if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(`${e?.message} ${(e as { code?: string } | null)?.code ?? ''}`)) why = 'the domain does not exist (no DNS record)';
    }
  }
  return { ok: false, why };
}
