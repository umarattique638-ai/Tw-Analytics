/**
 * Svelte / SvelteKit adapter. Svelte has no provider tree to hook into, so this is the npm entry with a
 * Svelte-shaped name, safe to call during SSR:
 *
 *   // src/routes/+layout.svelte (SvelteKit) or src/main.ts (Vite + Svelte)
 *   import { tailwatch } from '@tailwatch/svelte';
 *   tailwatch({ key: 'tw_pub_...', api: 'https://<collector>/e' });
 *
 *   import { track } from '@tailwatch/svelte';  track('signup', { plan: 'pro' });
 *
 * SvelteKit client navigations are history pushes: core sees them; nothing to wire.
 */
import { current, init } from '@tailwatch/browser';
import type { Api, Consent, Options, PageOptions, Props } from '@tailwatch/browser';

export type { Api, Consent, Options, PageOptions, Props } from '@tailwatch/browser';

/** Starts tracking (once per window). Returns a no-op on the server. */
export function tailwatch(options: Options): Api {
  return init(options);
}

export const track = (name: string, props?: Props): void => current().track(name, props);
export const page = (options?: PageOptions): void => current().page(options);
export const consent = (state: Consent): void => current().consent(state);
