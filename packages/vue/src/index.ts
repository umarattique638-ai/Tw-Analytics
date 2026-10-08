/**
 * Vue 3 adapter (works with Nuxt as a client plugin):
 *
 *   import { TailWatch } from '@tailwatch/vue';
 *   app.use(TailWatch, { key: 'tw_pub_...', api: 'https://<collector>/e', hashRouting: true });
 *
 *   const tw = useTailwatch();  tw.track('signup', { plan: 'pro' });   // or this.$tw in options API
 *
 * hashRouting: true for createWebHashHistory. Route changes are seen by core; nothing to wire.
 */
import type { App } from 'vue';
import { current, init } from '@tailwatch/browser';
import type { Api, Options } from '@tailwatch/browser';

export type { Api, Consent, Options, PageOptions, Props } from '@tailwatch/browser';

const handle: Api = {
  page: (o) => current().page(o),
  track: (name, props) => current().track(name, props),
  consent: (state) => current().consent(state),
};

export const TailWatch = {
  install(app: App, options: Options): void {
    init(options); // no-op on the server (SSR) and on a second install
    app.config.globalProperties.$tw = handle;
  },
};

export function useTailwatch(): Api {
  return handle;
}

declare module 'vue' {
  interface ComponentCustomProperties {
    $tw: Api;
  }
}
