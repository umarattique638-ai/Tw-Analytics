# @tailwatch/browser

The TailWatch tracker for browsers. One engine (`@tailwatch/core`), two ways in.

## Script tag (CDN)

```html
<script async src="https://tailwatch-collector.<account>.workers.dev/tw.js?id=tw_pub_..."></script>
```

| Attribute | Meaning |
|---|---|
| `data-id` | site key, if not given as `?id=` |
| `data-api` | collector endpoint; default `<script origin>/e`. Needed when you self-host `tw.js` |
| `data-hash` | hash-router app: `#/route` changes are pages |
| `data-consent="required"` | send nothing until `tw('consent', 'granted')`; `'denied'` discards |
| `data-manual` | no automatic pageviews; call `tw('page')` yourself |
| `data-allow-local` | also send from localhost |
| `data-allow-iframe` | also send from inside an iframe |

Custom events, also before the script has loaded:

```html
<script>window.tw=window.tw||function(){(tw.q=tw.q||[]).push(arguments)}</script>
<script>tw('track', 'signup', { plan: 'pro' });</script>
```

Visitors opt out with `?tw_disable=1` (remembered in this browser; `?tw_disable=0` undoes it).

## npm

```ts
import { init } from '@tailwatch/browser';

const tw = init({ key: 'tw_pub_...', api: 'https://tailwatch-collector.<account>.workers.dev/e' });
tw.track('signup', { plan: 'pro' });
tw.consent('granted');
```

Options: `key`, `api` (required), `hashRouting`, `consent` (`'granted'` default | `'unknown'`), `auto`
(default `true`: first pageview + SPA route changes), `allowLocal`, `allowIframe`. Calling `init` twice
(React StrictMode, HMR, a script tag on the same page) returns the first instance.

## What it guarantees (PLAN 4, 8.1)

`text/plain` body, no preflight, no cookies, no storage except the opt-out flag · never `unload` /
`beforeunload` · exactly one pageview per navigation (normalise + de-dup + 50 ms settle) · engagement =
visible AND focused time · tracker version on every hit · `tw.js` <= 3 KB gzip, the build fails otherwise.
