import { WIRE_VERSION, FLAG_FIRST_PAGEVIEW } from '@tailwatch/contract';
import type { PropValue } from '@tailwatch/contract';

export type ConsentState = 'unknown' | 'granted' | 'denied';

export interface TrackerConfig {
  site: string;
  endpoint: string;
  version?: number;
  autoPageview?: boolean;
  hashRouting?: boolean;
  allowLocal?: boolean;
  allowIframe?: boolean;
  disabled?: boolean;
  debug?: boolean;
}

export interface EventPayload {
  s: string;
  n: string;
  u: string;
  q: number;
  t: number;
  v: number;
  r?: string;
  e?: number;
  rt?: string;
  w?: number;
  i?: string;
  f?: number;
  p?: Record<string, PropValue>;
}

export interface CoreEnvironment {
  now(): number;
  url(): string;
  referrer(): string;
  viewportWidth(): number;
  isVisible(): boolean;
  isFocused(): boolean;
  randomId(): string;
  isOnline(): boolean;
  onOnline(fn: () => void): () => void;
  onVisibility(fn: () => void): () => void;
  onFocus(fn: () => void): () => void;
  onPageShow(fn: (persisted: boolean) => void): () => void;
}

export type Send = (
  payload: EventPayload,
  reason: 'pageview' | 'event' | 'flush'
) => Promise<boolean> | boolean;

export interface Tracker {
  pageview(url?: string): boolean;
  track(name: string, props?: Record<string, PropValue>): boolean;
  setConsent(state: ConsentState): void;
  getConsent(): ConsentState;
  flush(): Promise<void>;
  destroy(): void;
}

const DEFAULT_VERSION = WIRE_VERSION;
const MAX_PAYLOAD_BYTES = 32 * 1024;
const DEFAULT_ENDPOINT = '/e';

export function normalizeNavigationUrl(input: string): string {
  try {
    const u = new URL(input, 'https://tailwatch.invalid');
    const host = u.hostname.toLowerCase();

    let pathname = u.pathname || '/';

    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }

    const allowed = new URLSearchParams();

    for (const [k, v] of u.searchParams) {
      const key = k.toLowerCase();

      if (
        key.startsWith('utm_') ||
        key === 'gclid' ||
        key === 'fbclid'
      ) {
        allowed.set(key, v);
      }
    }

    const query = [...allowed.entries()].sort(([a], [b]) =>
      a.localeCompare(b)
    );

    return `${u.protocol.toLowerCase()}//${host}${pathname}${
      query.length ? `?${new URLSearchParams(query)}` : ''
    }`;
  } catch {
    return input.split('#', 1)[0];
  }
}

export function resolveConfig(
  input: Partial<TrackerConfig> & { site: string },
  locationUrl = ''
): TrackerConfig {
  const source = locationUrl ? new URL(locationUrl) : null;

  const site =
    input.site ||
    source?.searchParams.get('tw_site') ||
    '';

  const endpoint =
    input.endpoint ||
    source?.searchParams.get('tw_endpoint') ||
    DEFAULT_ENDPOINT;

  return {
    site,
    endpoint,
    version: input.version ?? DEFAULT_VERSION,
    autoPageview: input.autoPageview ?? true,
    hashRouting: input.hashRouting ?? false,
    allowLocal: input.allowLocal ?? false,
    allowIframe: input.allowIframe ?? false,
    disabled: input.disabled ?? false,
    debug: input.debug ?? false,
  };
}

function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();

    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.endsWith('.localhost')
    );
  } catch {
    return false;
  }
}

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function createTracker(
  configInput: TrackerConfig,
  env: CoreEnvironment,
  send: Send
): Tracker {
  const config = {
    ...configInput,
    version: configInput.version ?? DEFAULT_VERSION,
  };

  let sequence = 0;
  let consent: ConsentState = 'granted';
  let lastNavigation = '';
  let pending: EventPayload[] = [];
  let destroyed = false;
  let firstPageview = true;

  let engagementStarted =
    env.isVisible() && env.isFocused()
      ? env.now()
      : null;

  let engagementMs = 0;

  const unsubscribers: Array<() => void> = [];

  const blocked = (): boolean => {
    if (destroyed || config.disabled || !config.site) {
      return true;
    }

    const url = env.url();

    if (!config.allowLocal && isLocalUrl(url)) {
      return true;
    }

    return false;
  };

  const stopEngagement = () => {
    if (engagementStarted !== null) {
      engagementMs += Math.max(
        0,
        env.now() - engagementStarted
      );

      engagementStarted = null;
    }
  };

  const startEngagement = () => {
    if (
      engagementStarted === null &&
      env.isVisible() &&
      env.isFocused()
    ) {
      engagementStarted = env.now();
    }
  };

  const makePayload = (
    name: string,
    url: string,
    props?: Record<string, PropValue>
  ): EventPayload => {
    sequence += 1;

    const payload: EventPayload = {
      s: config.site,
      n: name,
      u: url,
      q: sequence,
      t: env.now(),
      v: config.version ?? DEFAULT_VERSION,
      r: env.referrer(),
      e: engagementMs,
      w: env.viewportWidth(),
      i: env.randomId(),
    };

    if (firstPageview && name === 'pageview') {
      payload.f = FLAG_FIRST_PAGEVIEW;
    }

    if (props && Object.keys(props).length) {
      payload.p = props;
    }

    engagementMs = 0;

    return payload;
  };

  const enqueue = (
    payload: EventPayload,
    reason: 'pageview' | 'event' | 'flush'
  ): boolean => {
    const encoded = JSON.stringify(payload);

    if (bytes(encoded) > MAX_PAYLOAD_BYTES) {
      if (config.debug) {
        console.warn(
          '[tailwatch] payload exceeds 32 KiB and was dropped'
        );
      }

      return false;
    }

    if (consent === 'unknown') {
      pending.push(payload);
      return true;
    }

    if (consent === 'denied') {
      return false;
    }

    if (!env.isOnline()) {
      pending.push(payload);
      return true;
    }

    const result = send(payload, reason);

    if (result instanceof Promise) {
      void result.then(ok => {
        if (!ok) {
          pending.push(payload);
        }
      });

      return true;
    }

    if (!result) {
      pending.push(payload);
    }

    return result;
  };

  const pageview = (
    url = env.url(),
    force = false
  ): boolean => {
    if (blocked()) {
      return false;
    }

    const normalized = normalizeNavigationUrl(url);

    if (
      !force &&
      normalized === lastNavigation
    ) {
      return false;
    }

    lastNavigation = normalized;

    const payload = makePayload(
      'pageview',
      url
    );

    const sent = enqueue(
      payload,
      'pageview'
    );

    firstPageview = false;

    return sent;
  };

  const track = (
    name: string,
    props?: Record<string, PropValue>
  ): boolean => {
    if (blocked() || !name) {
      return false;
    }

    return enqueue(
      makePayload(
        name,
        env.url(),
        props
      ),
      'event'
    );
  };

  const flush = async () => {
    if (
      consent !== 'granted' ||
      !env.isOnline() ||
      !pending.length
    ) {
      return;
    }

    const items = pending;
    pending = [];

    for (const payload of items) {
      const ok = await send(
        payload,
        'flush'
      );

      if (!ok) {
        pending.push(payload);
      }
    }
  };

  const setConsent = (
    state: ConsentState
  ) => {
    consent = state;

    if (state === 'denied') {
      pending = [];
    }

    if (state === 'granted') {
      void flush();
    }
  };

  const flushEngagement = () => {
    if (engagementMs <= 0) {
      return;
    }

    if (pending.length) {
      const last =
        pending[pending.length - 1]!;

      last.e =
        (last.e ?? 0) +
        engagementMs;

      engagementMs = 0;

      return;
    }

    const payload =
      makePayload(
        'engagement',
        env.url()
      );

    void enqueue(
      payload,
      'event'
    );
  };

  const onVisibility = () => {
    if (
      env.isVisible() &&
      env.isFocused()
    ) {
      startEngagement();
    } else {
      stopEngagement();

      if (!env.isVisible()) {
        flushEngagement();
      }
    }

    if (!env.isVisible()) {
      void flush();
    }
  };

  const onFocus = () => {
    if (
      env.isVisible() &&
      env.isFocused()
    ) {
      startEngagement();
    } else {
      stopEngagement();

      if (!env.isVisible()) {
        flushEngagement();
      }
    }
  };

  unsubscribers.push(
    env.onOnline(() => void flush())
  );

  unsubscribers.push(
    env.onVisibility(onVisibility)
  );

  unsubscribers.push(
    env.onFocus(onFocus)
  );

  unsubscribers.push(
    env.onPageShow(persisted => {
      if (persisted) {
        pageview(
          env.url(),
          true
        );
      }
    })
  );

  return {
    pageview,
    track,
    setConsent,
    getConsent: () => consent,
    flush,

    destroy: () => {
      destroyed = true;
      stopEngagement();

      for (
        const unsubscribe
        of unsubscribers
      ) {
        unsubscribe();
      }

      unsubscribers.length = 0;
    },
  };
}

export {
  MAX_PAYLOAD_BYTES
};