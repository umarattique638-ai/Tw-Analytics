import {
  createTracker,
  type ConsentState,
  type EventPayload,
  type Tracker,
  type TrackerConfig,
} from '@tailwatch/core';

import type { PropValue } from '@tailwatch/contract';

export interface BrowserConfig
  extends Partial<
    Omit<TrackerConfig, 'site'>
  > {
  site: string;
  endpoint?: string;
  autoPageview?: boolean;
  hashRouting?: boolean;
  allowLocal?: boolean;
  allowIframe?: boolean;
}

const GLOBAL_KEY =
  '__TAILWATCH_BROWSER__';

type WindowWithTailwatch =
  Window & {
    [GLOBAL_KEY]?: Tracker;
  };

function isLocalhost(): boolean {
  const h =
    window.location.hostname.toLowerCase();

  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '::1' ||
    h.endsWith('.localhost')
  );
}

function queryConfig(): Partial<BrowserConfig> {
  const params =
    new URLSearchParams(
      window.location.search
    );

  return {
    site:
      params.get('tw_site') ?? '',

    endpoint:
      params.get('tw_endpoint') ??
      undefined,

    disabled:
      params.get('tw_disable') === '1',
  };
}

function dataConfig(
  script: HTMLScriptElement | null
): Partial<BrowserConfig> {
  if (!script) {
    return {};
  }

  return {
    site:
      script.dataset.site ?? '',

    endpoint:
      script.dataset.api ??
      undefined,

    allowLocal:
      script.dataset.allowLocal === 'true',

    hashRouting:
      script.dataset.hashRouting === 'true',

    autoPageview:
      script.dataset.autoPageview !== 'false',

    allowIframe:
      script.dataset.allowIframe === 'true',
  };
}

function findScript():
  HTMLScriptElement | null {
  const current =
    document.currentScript;

  if (
    current instanceof
    HTMLScriptElement
  ) {
    return current;
  }

  return document.querySelector(
    'script[src*="tailwatch"]'
  );
}

function makeTransport(
  endpoint: string
) {
  const post = async (
    payload: EventPayload,
    keepalive: boolean
  ): Promise<boolean> => {
    try {
      const response =
        await fetch(endpoint, {
          method: 'POST',
          headers: {
            'content-type':
              'text/plain',
          },
          body: JSON.stringify(payload),
          keepalive,
          credentials: 'omit',
        });

      return response.ok;
    } catch {
      return false;
    }
  };

  const send = async (
    payload: EventPayload,
    reason:
      | 'pageview'
      | 'event'
      | 'flush'
  ): Promise<boolean> => {
    if (
      reason === 'flush' &&
      navigator.sendBeacon
    ) {
      const ok =
        navigator.sendBeacon(
          endpoint,
          new Blob(
            [JSON.stringify(payload)],
            {
              type: 'text/plain',
            }
          )
        );

      if (ok) {
        return true;
      }
    }

    return post(
      payload,
      reason !== 'flush'
    );
  };

  return send;
}

function attachNavigation(
  tracker: Tracker,
  hashRouting: boolean
): () => void {
  let timer:
    | number
    | undefined;

  let lastUrl =
    location.href;

  const schedule = () => {
    window.clearTimeout(timer);

    timer =
      window.setTimeout(() => {
        const next =
          location.href;

        if (next !== lastUrl) {
          lastUrl = next;
          tracker.pageview(next);
        }
      }, 50);
  };

  const nav =
    (
      window as Window & {
        navigation?: {
          addEventListener?: (
            name: string,
            fn: () => void
          ) => void;

          removeEventListener?: (
            name: string,
            fn: () => void
          ) => void;
        };
      }
    ).navigation;

  if (nav?.addEventListener) {
    const onNavigate =
      () => schedule();

    nav.addEventListener(
      'navigate',
      onNavigate
    );

    return () => {
      nav.removeEventListener?.(
        'navigate',
        onNavigate
      );

      window.clearTimeout(
        timer
      );
    };
  }

  const onPop =
    () => schedule();

  window.addEventListener(
    'popstate',
    onPop
  );

  if (hashRouting) {
    window.addEventListener(
      'hashchange',
      onPop
    );
  }

  const history =
    window.history;

  const originalPush =
    history.pushState;

  const originalReplace =
    history.replaceState;

  history.pushState =
    function (...args) {
      const r =
        originalPush.apply(
          this,
          args
        );

      schedule();

      return r;
    };

  history.replaceState =
    function (...args) {
      return originalReplace.apply(
        this,
        args
      );
    };

  return () => {
    window.removeEventListener(
      'popstate',
      onPop
    );

    if (hashRouting) {
      window.removeEventListener(
        'hashchange',
        onPop
      );
    }

    window.clearTimeout(timer);

    history.pushState =
      originalPush;

    history.replaceState =
      originalReplace;
  };
}

function createBrowserEnvironment() {
  return {
    now: () =>
      Date.now(),

    url: () =>
      location.href,

    referrer: () =>
      document.referrer,

    viewportWidth: () =>
      window.innerWidth || 0,

    isVisible: () =>
      document.visibilityState ===
      'visible',

    isFocused: () =>
      document.hasFocus(),

    randomId: () =>
      crypto.randomUUID(),

    isOnline: () =>
      navigator.onLine,

    onOnline: (
      fn: () => void
    ) => {
      window.addEventListener(
        'online',
        fn
      );

      return () =>
        window.removeEventListener(
          'online',
          fn
        );
    },

    onVisibility: (
      fn: () => void
    ) => {
      document.addEventListener(
        'visibilitychange',
        fn
      );

      return () =>
        document.removeEventListener(
          'visibilitychange',
          fn
        );
    },

    onFocus: (
      fn: () => void
    ) => {
      window.addEventListener(
        'focus',
        fn
      );

      window.addEventListener(
        'blur',
        fn
      );

      return () => {
        window.removeEventListener(
          'focus',
          fn
        );

        window.removeEventListener(
          'blur',
          fn
        );
      };
    },

    onPageShow: (
      fn: (
        persisted: boolean
      ) => void
    ) => {
      const h = (
        e: PageTransitionEvent
      ) =>
        fn(e.persisted);

      window.addEventListener(
        'pageshow',
        h
      );

      return () =>
        window.removeEventListener(
          'pageshow',
          h
        );
    },
  };
}

export function init(
  input: BrowserConfig
): Tracker | undefined {
  const existing =
    (
      window as WindowWithTailwatch
    )[GLOBAL_KEY];

  if (existing) {
    return existing;
  }

  const q =
    queryConfig();

  const script =
    findScript();

  const d =
    dataConfig(script);

  const site =
    input.site ||
    q.site ||
    d.site;

  if (!site) {
    return undefined;
  }

  const config: TrackerConfig = {
    site,

    endpoint:
      input.endpoint ||
      q.endpoint ||
      d.endpoint ||
      '/e',

    version:
      input.version,

    autoPageview:
      input.autoPageview ??
      d.autoPageview ??
      true,

    hashRouting:
      input.hashRouting ??
      d.hashRouting ??
      false,

    allowLocal:
      input.allowLocal ??
      d.allowLocal ??
      false,

    allowIframe:
      input.allowIframe ??
      d.allowIframe ??
      false,

    disabled:
      input.disabled ??
      q.disabled ??
      false,

    debug:
      input.debug,
  };

  if (
    !config.allowLocal &&
    isLocalhost()
  ) {
    return undefined;
  }

  if (
    !config.allowIframe &&
    window.top !== window.self
  ) {
    return undefined;
  }

  if (
    localStorage.getItem(
      'tw_disable'
    ) === '1' ||
    q.disabled
  ) {
    return undefined;
  }

  const tracker =
    createTracker(
      config,
      createBrowserEnvironment(),
      makeTransport(
        config.endpoint
      )
    );

  const detach =
    attachNavigation(
      tracker,
      config.hashRouting ?? false
    );

  const originalDestroy =
    tracker.destroy.bind(
      tracker
    );

  tracker.destroy = () => {
    detach();
    originalDestroy();

    if (
      (
        window as WindowWithTailwatch
      )[GLOBAL_KEY] === tracker
    ) {
      delete (
        window as WindowWithTailwatch
      )[GLOBAL_KEY];
    }
  };

  (
    window as WindowWithTailwatch
  )[GLOBAL_KEY] = tracker;

  if (
    config.autoPageview !== false
  ) {
    tracker.pageview();
  }

  return tracker;
}

export function setConsent(
  state: ConsentState
): void {
  const tracker =
    (
      window as WindowWithTailwatch
    )[GLOBAL_KEY];

  tracker?.setConsent(state);
}

export function track(
  name: string,
  props?: Record<
    string,
    PropValue
  >
): boolean {
  const tracker =
    (
      window as WindowWithTailwatch
    )[GLOBAL_KEY];

  return (
    tracker?.track(
      name,
      props
    ) ?? false
  );
}

export function pageview(
  url?: string
): boolean {
  const tracker =
    (
      window as WindowWithTailwatch
    )[GLOBAL_KEY];

  return (
    tracker?.pageview(url) ??
    false
  );
}

export function getTracker():
  Tracker | undefined {
  return (
    window as WindowWithTailwatch
  )[GLOBAL_KEY];
}