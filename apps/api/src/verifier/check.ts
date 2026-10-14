import { hostAllowed } from '@tailwatch/contract/url';
import { cspAllows } from './csp';
import { fetchLimited } from './fetch';
import { attr, findSnippets } from './html';
import { CHECK_ORDER, LABELS, VerifyInputError } from './types';
import type { ActiveResult, CheckId, CheckResult, VerifierOptions } from './types';

const result = (id: CheckId, status: CheckResult['status'], message: string): CheckResult => ({ id, label: LABELS[id], status, message });

/**
 * Runs the 7 checks against `rawUrl` (default https://<domain>/), in the order of CHECK_ORDER, and stops at
 * the first one that fails, saying in words what to fix.
 */
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

  // The order a browser goes through. The first failing step ends the check: the steps after it are
  // "not checked" (a later result means nothing while an earlier step is broken).
  const checks: CheckResult[] = [];
  const stop = (failed: CheckResult): ActiveResult => {
    checks.push(failed);
    for (const id of CHECK_ORDER.slice(checks.length)) checks.push(result(id, 'skip', 'Not checked: fix the step above first.'));
    return { url: page.href, ok: false, checks };
  };

  // 1. Site reachable
  let html = '';
  let headers: Headers;
  let finalUrl = page.href;
  try {
    const got = await fetchLimited(page.href, o, 'text/html,*/*;q=0.5');
    headers = got.res.headers;
    finalUrl = got.finalUrl;
    if (!got.res.ok) return stop(result('reach', 'fail', `We reached ${page.hostname}, but it answered HTTP ${got.res.status}.`));
    html = got.body;
    checks.push(result('reach', 'pass', `${new URL(finalUrl).hostname} answered HTTP ${got.res.status}.`));
  } catch (error) {
    const why =
      error instanceof Error && error.name === 'TimeoutError'
        ? 'timeout'
        : error instanceof Error && error.message === 'private address'
          ? 'it resolves to a private network address'
          : error instanceof Error && error.message === 'blocked port'
            ? 'only ports 80, 443, 8080 and 8443 can be checked'
            : 'connection failed';
    return stop(result('reach', 'fail', `We couldn't reach ${page.hostname} (${why}).`));
  }

  // 2. Snippet in page source
  const tags = findSnippets(html, finalUrl);
  const visible = tags.filter((t) => !t.hidden);
  const hidden = tags.filter((t) => t.hidden);
  if (tags.length === 0) {
    return stop(result('present', 'fail', "The snippet isn't in the page source. Paste it inside <head> and publish the change; if you use a cache or CDN, purge it."));
  }
  checks.push(result('present', 'pass', `Found ${tags.length === 1 ? 'the snippet' : `${tags.length} snippets`} in the page source.`));

  // 3. Not in noscript or a comment
  if (visible.length === 0) {
    return stop(result('noscript', 'fail', `The snippet is inside ${hidden[0]!.hidden === 'comment' ? 'an HTML comment' : 'a <noscript> block'}, so it never runs. Move it into <head>.`));
  }
  checks.push(result('noscript', 'pass', 'The snippet is live (not commented out, not in <noscript>).'));

  // 4. Only one snippet
  if (visible.length > 1) {
    return stop(result('once', 'fail', `We found the snippet ${visible.length} times; remove all but one. (The second copy does nothing, but it is a sign of a duplicated template.)`));
  }
  checks.push(result('once', 'pass', 'Exactly one snippet.'));
  const tag = visible[0]!;

  // 5. Script loads
  try {
    const s = await fetchLimited(tag.src, o, 'application/javascript,*/*;q=0.5');
    const type = s.res.headers.get('content-type') ?? '';
    if (!s.res.ok || !/javascript|ecmascript/i.test(type)) {
      return stop(result('script', 'fail', `The script URL answered HTTP ${s.res.status}${type ? ` (${type.split(';')[0]})` : ''}. Check the src in the snippet.`));
    }
  } catch {
    return stop(result('script', 'fail', `We couldn't load ${tag.src}.`));
  }
  checks.push(result('script', 'pass', 'tw.js loads.'));

  // 6. Content-Security-Policy allows it
  const policies = [
    ...(headers.get('content-security-policy') ? [headers.get('content-security-policy')!] : []),
    ...[...html.matchAll(/<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi)].map((m) => attr(m[0], 'content') ?? ''),
  ].filter(Boolean);
  const pageOrigin = new URL(finalUrl).origin;
  const apiUrl = tag.api ? new URL(tag.api, finalUrl).href : `${new URL(tag.src).origin}/e`;
  if (!cspAllows(policies, 'script-src', tag.src, pageOrigin)) {
    return stop(result('csp', 'fail', `The script is blocked: add ${new URL(tag.src).origin} to your Content-Security-Policy script-src.`));
  }
  if (!cspAllows(policies, 'connect-src', apiUrl, pageOrigin)) {
    return stop(result('csp', 'fail', `Hits are blocked: add ${new URL(apiUrl).origin} to your Content-Security-Policy connect-src.`));
  }
  checks.push(result('csp', 'pass', policies.length ? 'Your Content-Security-Policy allows the script and its hits.' : 'No Content-Security-Policy restricts it.'));

  // 7. Site key matches
  const active = new Set(site.keys.filter((k) => k.status === 'active').map((k) => k.publicKey));
  const known = new Set(site.keys.map((k) => k.publicKey));
  if (!tag.key) return stop(result('id', 'fail', 'The snippet has no site key (?id=tw_pub_...). Copy the snippet again.'));
  if (known.has(tag.key) && !active.has(tag.key)) return stop(result('id', 'fail', 'The snippet uses a key you revoked. Copy the current snippet again.'));
  if (!active.has(tag.key)) return stop(result('id', 'fail', `The snippet on your site uses a different site key (${tag.key}). Copy this site's snippet and replace the old one.`));
  checks.push(result('id', 'pass', "The snippet uses this site's key."));

  return { url: page.href, ok: true, checks };
}
