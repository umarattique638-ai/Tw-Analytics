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

export function TailwatchProvider({ children, siteKey, ...options }: TailwatchProps) {
  // Runs once per mount in the browser only (effects never run on the server).
  // StrictMode runs it twice in dev: the second init() returns the first instance.
  useEffect(() => {
    init({ key: siteKey, ...options });
    // Options are read once, like a script tag's attributes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <>{children}</>;
}

/** Stable handle; calls before init or on the server are no-ops. */
const handle: Api = {
  page: (o) => current().page(o),
  track: (name, props) => current().track(name, props),
  consent: (state) => current().consent(state),
};

export function useTailwatch(): Api {
  return handle;
}
