/**
 * CDN channel (PLAN 7, method 1.1), built to tw.js:
 *
 *   <script async src="https://<collector>/tw.js?id=tw_pub_..."></script>
 *
 * Config resolution (BUILD-ORDER Stage 4): ?id= on the script URL, then data-* attributes, then defaults.
 *   data-id             site key, if not in ?id=
 *   data-api            collector endpoint (default: <script origin>/e; needed when self-hosting tw.js)
 *   data-hash           hash-router site (#/route changes are pages)
 *   data-consent="required"   send nothing until tw('consent', 'granted')
 *   data-manual         no automatic pageviews; call tw('page')
 *   data-allow-local    also send from localhost
 *   data-allow-iframe   also send from inside an iframe
 *
 * Calls made before the script loads are queued by the stub and replayed:
 *   <script>window.tw=window.tw||function(){(tw.q=tw.q||[]).push(arguments)}</script>
 *   tw('track', 'signup', { plan: 'pro' });  tw('consent', 'granted');  tw('page');
 */
import { start } from './start';
import type { Api } from './start';

type Command = keyof Api;
type Tw = ((cmd: Command, ...args: unknown[]) => void) & { q?: ArrayLike<unknown>[] };

const script = document.currentScript as HTMLScriptElement | null;
if (script) {
  const d = script.dataset;
  const src = new URL(script.src);
  const api = start({
    key: src.searchParams.get('id') || d.id || '',
    api: d.api || src.origin + '/e',
    hashRouting: 'hash' in d,
    consent: d.consent === 'required' ? 'unknown' : 'granted',
    auto: !('manual' in d),
    allowLocal: 'allowLocal' in d,
    allowIframe: 'allowIframe' in d,
  });
  const w = window as Window & { tw?: Tw };
  const queued = w.tw?.q || [];
  const tw: Tw = (cmd, ...args) => {
    const fn = api[cmd] as ((...a: unknown[]) => void) | undefined;
    if (typeof fn === 'function') fn(...args);
  };
  w.tw = tw;
  for (const call of Array.from(queued)) tw(...(Array.from(call) as [Command, ...unknown[]]));
}
