import { hostAllowed } from '@tailwatch/contract/url';
import { cspAllows } from './csp';
import { fetchLimited } from './fetch';
import { attr, findSnippets } from './html';
import { LABELS, VerifyInputError } from './types';
import type { ActiveResult, CheckId, CheckResult, VerifierOptions } from './types';

const result = (id: CheckId, status: CheckResult['status'], message: string): CheckResult => ({ id, label: LABELS[id], status, message });

/** Runs the 7 checks against `rawUrl` (default https://<domain>/) and says which one failed, in words. */
export async function runActiveCheck(
  site: { domain: string; allowedHosts: string[]; keys: { publicKey: string; status: string }[] },
  rawUrl: string | undefined,
  o: VerifierOptions = {},
): Promise<ActiveResult> {
  const url = rawUrl?.trim() || `https://${site.domain}/`;
  let page: URL;
  try {
    page = new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`);
  } catch {
    throw new VerifyInputError('That is not a valid URL.');
  }
  if (page.protocol !== 'https:' && page.protocol !== 'http:') throw new VerifyInputError('Only http and https pages can be checked.');
  if (!hostAllowed(page.hostname, site.allowedHosts)) {
    throw new VerifyInputError(`${page.hostname} is not one of this site's hosts (${site.allowedHosts.join(', ')}).`);
  }

  const checks: CheckResult[] = [];
  const skipRest = (from: CheckId[]) => from.forEach((id) => checks.push(result(id, 'skip', 'Not checked: an earlier step failed.')));
  const ALL: CheckId[] = ['reach', 'present', 'noscript', 'once', 'id', 'script', 'csp'];

  let html = '';
  let headers: Headers;
  let finalUrl = page.href;
  try {
    const got = await fetchLimited(page.href, o, 'text/html,*/*;q=0.5');
    headers = got.res.headers;
    finalUrl = got.finalUrl;
    if (!got.res.ok) {
      checks.push(result('reach', 'fail', `We reached ${page.hostname}, but it answered HTTP ${got.res.status}.`));
      skipRest(ALL.slice(1));
      return { url: page.href, ok: false, checks };
    }
    html = got.body;
    checks.push(result('reach', 'pass', `${new URL(finalUrl).hostname} answered HTTP ${got.res.status}.`));
  } catch (error) {
    const why = error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : error instanceof Error && error.message === 'private address' ? 'it resolves to a private network address' : error instanceof Error && error.message === 'blocked port' ? 'only ports 80, 443, 8080 and 8443 can be checked' : 'connection failed';
    checks.push(result('reach', 'fail', `We couldn't reach ${page.hostname} (${why}).`));
    skipRest(ALL.slice(1));
    return { url: page.href, ok: false, checks };
  }

  const tags = findSnippets(html, finalUrl);
  const visible = tags.filter((t) => !t.hidden);
  const hidden = tags.filter((t) => t.hidden);
  if (tags.length === 0) {
    checks.push(result('present', 'fail', "The snippet isn't in the page source. Paste it inside <head> and publish the change; if you use a cache or CDN, purge it."));
    skipRest(ALL.slice(2));
    return { url: page.href, ok: false, checks };
  }
  checks.push(result('present', 'pass', `Found ${tags.length === 1 ? 'the snippet' : `${tags.length} snippets`} in the page source.`));
  if (visible.length === 0) {
    checks.push(result('noscript', 'fail', `The snippet is inside ${hidden[0]!.hidden === 'comment' ? 'an HTML comment' : 'a <noscript> block'}, so it never runs. Move it into <head>.`));
    skipRest(ALL.slice(3));
    return { url: page.href, ok: false, checks };
  }
  checks.push(result('noscript', 'pass', 'The snippet is live (not commented out, not in <noscript>).'));
  checks.push(
    visible.length === 1
      ? result('once', 'pass', 'Exactly one snippet.')
      : result('once', 'fail', `We found the snippet ${visible.length} times; remove all but one. (The second copy does nothing, but it is a sign of a duplicated template.)`),
  );

  const tag = visible[0]!;
  const active = new Set(site.keys.filter((k) => k.status === 'active').map((k) => k.publicKey));
  const known = new Set(site.keys.map((k) => k.publicKey));
  checks.push(
    tag.key && active.has(tag.key)
      ? result('id', 'pass', 'The snippet uses this site\'s key.')
      : tag.key && known.has(tag.key)
        ? result('id', 'fail', 'The snippet uses a key you revoked. Copy the current snippet again.')
        : result('id', 'fail', tag.key ? `The snippet on your site uses a different site key (${tag.key}).` : 'The snippet has no site key (?id=tw_pub_...).'),
  );

  try {
    const s = await fetchLimited(tag.src, o, 'application/javascript,*/*;q=0.5');
    const type = s.res.headers.get('content-type') ?? '';
    checks.push(
      s.res.ok && /javascript|ecmascript/i.test(type)
        ? result('script', 'pass', 'tw.js loads.')
        : result('script', 'fail', `The script URL answered HTTP ${s.res.status}${type ? ` (${type.split(';')[0]})` : ''}. Check the src in the snippet.`),
    );
  } catch {
    checks.push(result('script', 'fail', `We couldn't load ${tag.src}.`));
  }

  const policies = [
    ...(headers.get('content-security-policy') ? [headers.get('content-security-policy')!] : []),
    ...[...html.matchAll(/<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi)].map((m) => attr(m[0], 'content') ?? ''),
  ].filter(Boolean);
  const pageOrigin = new URL(finalUrl).origin;
  const apiUrl = tag.api ? new URL(tag.api, finalUrl).href : `${new URL(tag.src).origin}/e`;
  if (!cspAllows(policies, 'script-src', tag.src, pageOrigin)) {
    checks.push(result('csp', 'fail', `The script is blocked: add ${new URL(tag.src).origin} to your Content-Security-Policy script-src.`));
  } else if (!cspAllows(policies, 'connect-src', apiUrl, pageOrigin)) {
    checks.push(result('csp', 'fail', `Hits are blocked: add ${new URL(apiUrl).origin} to your Content-Security-Policy connect-src.`));
  } else {
    checks.push(result('csp', 'pass', policies.length ? 'Your Content-Security-Policy allows the script and its hits.' : 'No Content-Security-Policy restricts it.'));
  }
  return { url: page.href, ok: checks.every((c) => c.status === 'pass'), checks };
}
