/**
 * Browser platform for @tailwatch/core. Shared by the CDN script (cdn.ts) and the npm entry
 * (index.ts), so both channels behave identically. PLAN 8.1 is the spec.
 */
import { createTracker } from '@tailwatch/core';
import type { Consent, PageOptions, Props, Tracker } from '@tailwatch/core';

export interface Options {
  /** Site public key, tw_pub_... */
  key: string;
  /** Collector endpoint, e.g. https://collector.example/e */
  api: string;
  /** Count `#/route` changes as pages (hash routers). Default false. */
  hashRouting?: boolean;
  /** 'unknown' = send nothing until consent('granted'). Default 'granted'. */
  consent?: Consent;
  /** Track pageviews automatically (first load + SPA route changes). Default true. */
  auto?: boolean;
  /** Send from localhost / *.local / file pages. Default false. */
  allowLocal?: boolean;
  /** Send from inside an iframe. Default false. */
  allowIframe?: boolean;
}

export interface Api {
  page(options?: PageOptions): void;
  track(name: string, props?: Props): void;
  consent(state: Consent): void;
}

export const NOOP: Api = { page() {}, track() {}, consent() {} };
const OPT_OUT = 'tw_disable';

type Win = Window & {
  __tw?: Api;
  navigation?: EventTarget;
  /** Automation globals (PhantomJS, Nightmare, Cypress): STAGE-1 A6. */
  _phantom?: unknown;
  callPhantom?: unknown;
  __nightmare?: unknown;
  Cypress?: unknown;
};

/** Visitor opt-out (PLAN 8.1): ?tw_disable=1 sets it permanently, ?tw_disable=0 clears it. */
function optedOut(): boolean {
  try {
    const flag = new URLSearchParams(location.search).get(OPT_OUT);
    if (flag === '1') localStorage.setItem(OPT_OUT, '1');
    if (flag === '0') localStorage.removeItem(OPT_OUT);
    return localStorage.getItem(OPT_OUT) === '1';
  } catch {
    // Storage blocked (privacy mode, sandboxed iframe): only the query flag can opt out.
    return location.search.indexOf(OPT_OUT + '=1') > -1;
  }
}

function isLocal(): boolean {
  return location.protocol === 'file:' || /^(localhost|127\.|\[::1\]$|0\.0\.0\.0$)|\.(local|localhost)$/.test(location.hostname);
}

function inIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true; // cross-origin parent
  }
}

function id(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  // randomUUID needs a secure context; plain-http pages get the fallback.
  return c?.randomUUID ? c.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/**
 * Transport (invariants 4 + 5): the body is a string, so the browser sends
 * `Content-Type: text/plain;charset=UTF-8`, a CORS-safelisted type: no preflight. No custom headers,
 * no credentials. While the page is going away, sendBeacon; if the browser refuses it (quota),
 * fetch WITHOUT keepalive (keepalive shares the same 64 KiB budget).
 */
function transport(api: string) {
  const post = (body: string, keepalive: boolean) =>
    fetch(api, { method: 'POST', body, keepalive, credentials: 'omit' }).then(
      (r) => r.status !== 429,
      () => false,
    );
  return (body: string, hide: boolean): Promise<boolean> => {
    if (hide && navigator.sendBeacon) {
      try {
        if (navigator.sendBeacon(api, body)) return Promise.resolve(true);
      } catch {
        // fall through to fetch
      }
      return post(body, false);
    }
    return post(body, true);
  };
}

/** Starts tracking once per window. A second copy (script loaded twice, npm + CDN) is a no-op. */
export function start(o: Options): Api {
  if (typeof window === 'undefined') return NOOP; // server render (Next, Nuxt, SvelteKit): nothing to do
  const w = window as Win;
  if (w.__tw) return w.__tw;
  if (!o.key || !o.api || optedOut() || (isLocal() && !o.allowLocal) || (inIframe() && !o.allowIframe)) {
    return (w.__tw = NOOP);
  }

  const doc = document;
  const t: Tracker = createTracker(o, {
    now: Date.now,
    href: () => location.href,
    referrer: () => doc.referrer,
    width: () => innerWidth,
    active: () => doc.visibilityState === 'visible' && doc.hasFocus(),
    online: () => navigator.onLine !== false,
    id,
    send: transport(o.api),
    warn: (m) => console.warn(m),
    // Same signals Plausible checks, but we send + flag instead of going silent (STAGE-1 A6).
    automated: () => !!(navigator.webdriver || w._phantom || w.callPhantom || w.__nightmare || w.Cypress),
    uaMismatch: () => {
      // Only Chromium has userAgentData, and a real one always lists its brands. An EMPTY list is what a UA
      // override without metadata leaves (Puppeteer's setUserAgent); a headless brand speaks for itself.
      // Deliberately NOT "UA lacks Chrome": TVs, WebView2/Electron apps and UA-switcher extensions do that.
      const d = (navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } }).userAgentData;
      return !!d && (!d.brands.length || d.brands.some((b) => /headless/i.test(b.brand)));
    },
  });

  const api: Api = {
    page: (p) => t.page(p),
    track: (n, p) => t.track(n, p),
    consent: (c) => t.consent(c),
  };
  w.__tw = api;

  const on = (target: EventTarget, type: string, fn: (e: Event) => void) => target.addEventListener(type, fn);
  const activity = () => t.activity();

  const boot = () => {
    // Never `unload` / `beforeunload` (invariant 5): they break bfcache.
    on(w, 'focus', activity);
    on(w, 'blur', activity);
    on(doc, 'visibilitychange', () => (doc.visibilityState === 'hidden' ? t.hide() : activity()));
    on(w, 'pagehide', () => t.hide());
    on(w, 'online', () => t.flush());
    on(w, 'pageshow', (e) => {
      if ((e as PageTransitionEvent).persisted) {
        activity();
        if (o.auto !== false) t.page({ force: true }); // bfcache restore is a view (PLAN 8.1)
      }
    });
    t.activity();

    if (o.auto !== false) {
      const route = () => t.page();
      if (w.navigation) {
        // Navigation API: one event for push, replace, traverse and fragment navigations.
        on(w.navigation, 'currententrychange', route);
      } else {
        const h = history;
        for (const m of ['pushState', 'replaceState'] as const) {
          const orig = h[m];
          h[m] = function (this: History, ...args: Parameters<History['pushState']>) {
            orig.apply(this, args);
            route();
          };
        }
        on(w, 'popstate', route);
        // pushState never fires hashchange; a plain `location.hash = ...` does.
        if (o.hashRouting) on(w, 'hashchange', route);
      }
      t.page();
    }
  };

  // A speculative prerender is not a view (PLAN 8.1): wait until it is shown.
  if ((doc as Document & { prerendering?: boolean }).prerendering) on(doc, 'prerenderingchange', boot);
  else boot();
  return api;
}

/** The running instance, or a no-op before init / on the server. Adapters' track() goes through this. */
export function current(): Api {
  return (typeof window !== 'undefined' && (window as Win).__tw) || NOOP;
}
