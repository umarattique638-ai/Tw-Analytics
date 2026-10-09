'use client';
/**
 * React adapter (PLAN 7, method 1.4). The adapter only STARTS the tracker; route changes, the
 * de-dup guard and the first pageview all live in core (invariants 10 + 11), so a router never has to
 * be wired in and React StrictMode's double effect cannot double count (init is idempotent).
 *
 *   <TailwatchProvider siteKey="tw_pub_..." api="https://<collector>/e">
 *     <App />
 *   </TailwatchProvider>
 *
 *   const tw = useTailwatch();  tw.track('signup', { plan: 'pro' });
 */
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { current, init } from '@tailwatch/browser';
import type { Api, Options } from '@tailwatch/browser';

export type { Api, Consent, Options, PageOptions, Props } from '@tailwatch/browser';

export interface TailwatchProps extends Omit<Options, 'key'> {
  /** Site public key, tw_pub_... */
  siteKey: string;
  children?: ReactNode;
}

/**
 * Child effects run BEFORE the provider's effect, so a child calling consent() or track() on mount
 * would reach the tracker before init(). Those calls wait here and run right after init (max 100).
 */
let started = false;
const early: ((api: Api) => void)[] = [];
const run = (fn: (api: Api) => void) => {
  if (started) fn(current());
  else if (typeof window !== 'undefined' && early.length < 100) early.push(fn);
};

export function TailwatchProvider({ children, siteKey, ...options }: TailwatchProps) {
  // Runs once per mount in the browser only (effects never run on the server).
  // StrictMode runs it twice in dev: the second init() returns the first instance.
  useEffect(() => {
    init({ key: siteKey, ...options });
    started = true;
    early.splice(0).forEach((fn) => fn(current()));
    // Options are read once, like a script tag's attributes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <>{children}</>;
}

/** Stable handle. Calls before init wait for it; on the server they are no-ops. */
const handle: Api = {
  page: (o) => run((a) => a.page(o)),
  track: (name, props) => run((a) => a.track(name, props)),
  consent: (state) => run((a) => a.consent(state)),
};

export function useTailwatch(): Api {
  return handle;
}
