/**
 * @tailwatch/core: the tracker engine. No DOM access here; the platform (browser, tests, a future
 * React Native port) supplies an Env. Everything PLAN 8.1 says about *what* is sent lives here, so
 * every channel (CDN script, npm, framework adapters) behaves identically (invariant 10).
 *
 * Wire: contract v1 (packages/contract/src/wire.ts). Every hit carries s n u q t v i x w,
 * plus e (engaged ms), f (flags), r (first pageview only), rt, p when present.
 */
import { normalizeUrl } from '@tailwatch/contract/url';
import { FLAG_AUTOMATION, FLAG_FIRST_PAGEVIEW, FLAG_HASH_ROUTE, FLAG_UA_MISMATCH } from '@tailwatch/contract/wire';

/** Sent as `v` on every hit (invariant 9). Bump on every released tracker change.
 *  1 = 2026-10-08 first deploy. 2 = first pageview carries no engagement; A4 root route; SSR-safe init.
 *  3 = Stage 7: FLAG_AUTOMATION and FLAG_UA_MISMATCH (A6) on every hit of an automated / spoofed page. */
export const TRACKER_VERSION = 3;
/** = LIMITS.maxBodyBytes (asserted by a test; not imported, to keep the bundle small). */
export const MAX_BODY_BYTES = 32_768;
/** SPA route changes settle for this long before a pageview is sent (PLAN 6.1). */
export const DEBOUNCE_MS = 50;
/** A hide-flush sends a separate `engagement` hit only when at least this much is unsent. */
export const ENGAGEMENT_FLUSH_MIN_MS = 1_000;
/** Hits kept in memory while consent is unknown or the network is down. Oldest dropped first. */
export const MAX_BUFFER = 100;
/** Retry delay after a 429 / network failure (the collector's Retry-After is 10 s). */
export const RETRY_MS = 10_000;
/** Retries back off up to this (a blocked collector must not be hit every 10 s forever). */
export const RETRY_MAX_MS = 300_000;
/** The collector's rule for event names (contract LIMITS): anything else would be a 400 and a fake "lost" hit. */
const NAME_RE = /^[a-z0-9_]{1,40}$/;
/** The collector refuses engagement over 24 h; a tab left open longer sends the cap. */
const MAX_ENGAGED_MS = 86_400_000;

export type Consent = 'unknown' | 'granted' | 'denied';
export type Props = Record<string, string | number | boolean>;

/**
 * Delivers one body. `hide` = the page is going away (sendBeacon territory).
 * Resolves true when the hit is done with (delivered, or rejected for good: 4xx other than 429),
 * false when it should be retried (offline, network error, 429).
 */
export type Send = (body: string, hide: boolean) => Promise<boolean>;

export interface Env {
  now(): number;
  href(): string;
  referrer(): string;
  width(): number;
  /** Visible AND focused (PLAN 8.1: an unfocused visible tab does not accrue engagement). */
  active(): boolean;
  online(): boolean;
  /** Insert id, unique per hit, <= 64 chars. */
  id(): string;
  send: Send;
  warn(message: string): void;
  /**
   * STAGE-1 A6: the page is driven by automation software (navigator.webdriver and friends). Read once.
   * The hits are still SENT, flagged, so the drop is itemised for the site owner instead of invisible.
   */
  automated?(): boolean;
  /** STAGE-1 A6: the JS engine contradicts the User-Agent string (spoofed UA). Read once. */
  uaMismatch?(): boolean;
}

export interface Config {
  key: string;
  hashRouting?: boolean;
  /** Default 'granted'. 'unknown' = buffer until consent('granted'|'denied'). */
  consent?: Consent;
}

export interface PageOptions {
  /** Defaults to the current location. */
  url?: string;
  /** Route template, e.g. /blog/[slug]. */
  rt?: string;
  /** Send even if the URL did not change (bfcache restore). */
  force?: boolean;
}

export interface Tracker {
  page(options?: PageOptions): void;
  track(name: string, props?: Props): void;
  consent(state: Consent): void;
  /** Visibility or focus changed. */
  activity(): void;
  /** Page hidden / pagehide: stop the clock, ship what is pending with the beacon. */
  hide(): void;
  /** Network back: retry what failed. */
  flush(): void;
}

/** A hit before dispatch. q and x are assigned when it is actually sent. */
type Hit = Record<string, unknown>;

export function createTracker(config: Config, env: Env): Tracker {
  const hashFlag = config.hashRouting ? FLAG_HASH_ROUTE : 0;
  const flags = hashFlag | (env.automated?.() ? FLAG_AUTOMATION : 0) | (env.uaMismatch?.() ? FLAG_UA_MISMATCH : 0);
  let consent: Consent = config.consent ?? 'granted';
  let seq = 0;
  let first = true;
  let lastPage: string | undefined;
  let pending: PageOptions | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  /** Waiting for consent. */
  let held: Hit[] = [];
  /** Dispatched (q assigned) but not delivered. */
  let retry: Hit[] = [];
  let engaged = 0;
  let since = env.active() ? env.now() : 0;

  const tick = () => {
    const now = env.now();
    if (since) engaged += now - since;
    return now;
  };
  const takeEngaged = () => {
    since = since && tick();
    const e = engaged;
    engaged = 0;
    return e;
  };

  const cap = (list: Hit[], hit: Hit) => {
    list.push(hit);
    if (list.length > MAX_BUFFER) list.shift();
  };

  let wait = RETRY_MS;
  const scheduleRetry = () => {
    retryTimer ??= setTimeout(() => {
      retryTimer = undefined;
      wait = Math.min(wait * 2, RETRY_MAX_MS);
      flush(false);
    }, wait);
  };

  const deliver = (hit: Hit, hide: boolean) => {
    if (!env.online()) return cap(retry, hit), scheduleRetry();
    hit.x = env.now();
    const body = JSON.stringify(hit);
    // Bytes, not UTF-16 units: a body over the collector's cap would be a 413, so never send it.
    if (new Blob([body]).size > MAX_BODY_BYTES) return env.warn(`[tailwatch] event "${hit.n}" over 32 KB, dropped`);
    env.send(body, hide).then(
      (done) => (done ? (wait = RETRY_MS) : (cap(retry, hit), scheduleRetry())),
      () => (cap(retry, hit), scheduleRetry()),
    );
  };

  const dispatch = (hit: Hit, hide = false) => {
    // q is per page load and counts DISPATCHED hits only, so a gap means a lost beacon, never a hit we
    // chose not to send (consent, too big): the size check comes BEFORE q is taken.
    if (new Blob([JSON.stringify(hit)]).size > MAX_BODY_BYTES - 64) return env.warn(`[tailwatch] event "${hit.n}" over 32 KB, dropped`);
    hit.q = ++seq;
    deliver(hit, hide);
  };

  const flush = (hide: boolean) => {
    const again = retry;
    retry = [];
    again.forEach((hit) => deliver(hit, hide));
  };

  const emit = (hit: Hit, hide = false) => {
    if (consent === 'granted') dispatch(hit, hide);
    else if (consent === 'unknown') cap(held, hit);
  };

  const make = (n: string, u: string, extra: Hit): Hit => {
    const e = takeEngaged();
    const h: Hit = { s: config.key, n, u, t: env.now(), v: TRACKER_VERSION, i: env.id(), w: env.width(), ...extra };
    if (e) h.e = Math.min(e, MAX_ENGAGED_MS);
    if (flags) h.f = ((h.f as number) | 0) | flags;
    return h;
  };

  /** The contract's own normaliser: the client never sends a query parameter the server would strip. */
  const norm = (href: string) => normalizeUrl(href, undefined, !!hashFlag)?.href;

  const sendPage = (o: PageOptions, hide = false) => {
    const u = norm(o.url ?? env.href());
    if (!u) return; // not http(s): file://, about:blank, ...
    // The single de-dup guard (invariant 10): StrictMode double effects, replaceState noise,
    // trailing slashes and non-allowlisted query changes all normalise to the same key.
    if (u === lastPage && !o.force) return;
    lastPage = u;
    const extra: Hit = {};
    if (o.rt) extra.rt = o.rt;
    if (first) {
      first = false;
      extra.f = FLAG_FIRST_PAGEVIEW;
      // `e` is "engaged since the previous event"; the first pageview has none. Without this the
      // millisecond between script start and this call showed up as engagement_ms = 1 (live run).
      engaged = 0;
      if (since) since = env.now();
      const r = env.referrer().split(/[?#]/)[0];
      if (r) extra.r = r;
    }
    emit(make('pageview', u, extra), hide);
  };

  const firePending = (hide = false) => {
    clearTimeout(debounce);
    debounce = undefined;
    const o = pending;
    pending = undefined;
    if (o) sendPage(o, hide);
  };

  return {
    page(o = {}) {
      // The first pageview goes immediately (PLAN 8.1: get it out before a bounce);
      // route changes settle for DEBOUNCE_MS, last one wins.
      if (first) return sendPage(o);
      pending = o;
      clearTimeout(debounce);
      debounce = setTimeout(firePending, DEBOUNCE_MS);
    },

    track(name, props) {
      // A name the collector would refuse (400) is caught here, so it never counts as a lost hit.
      if (!NAME_RE.test(name)) return env.warn(`[tailwatch] event name "${name}" ignored: use a-z, 0-9 and _ (max 40)`);
      // A route change still settling must be sent first: the event belongs to the new page.
      firePending();
      const u = norm(env.href());
      if (!u) return;
      emit(make(name, u, props && Object.keys(props).length ? { p: props } : {}));
    },

    consent(state) {
      consent = state === 'granted' || state === 'unknown' ? state : 'denied';
      const list = held;
      held = [];
      if (consent === 'granted') list.forEach((h) => dispatch(h));
      else if (consent === 'denied') {
        // Withdrawn consent also stops what was waiting to be retried.
        retry = [];
        clearTimeout(retryTimer);
        retryTimer = undefined;
      }
    },

    activity() {
      if (since) tick();
      since = env.active() ? env.now() : 0;
    },

    hide() {
      firePending(true);
      if (since) tick();
      since = 0;
      if (engaged >= ENGAGEMENT_FLUSH_MIN_MS) {
        const u = norm(env.href());
        if (u) emit(make('engagement', u, {}), true);
      }
      if (consent === 'granted') flush(true);
    },

    flush() {
      clearTimeout(retryTimer);
      retryTimer = undefined;
      flush(false);
    },
  };
}
