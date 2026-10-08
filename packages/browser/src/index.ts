/**
 * npm channel (PLAN 7, method 1.3):
 *
 *   import { init } from '@tailwatch/browser';
 *   const tw = init({ key: 'tw_pub_...', api: 'https://<collector>/e' });
 *   tw.track('signup', { plan: 'pro' });
 *
 * Calling init twice (React StrictMode, HMR, a CDN tag on the same page) returns the first instance.
 */
export { start as init } from './start';
export type { Api, Options } from './start';
export type { Consent, PageOptions, Props } from '@tailwatch/core';
