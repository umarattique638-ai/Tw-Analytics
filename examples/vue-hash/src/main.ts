import { createApp } from 'vue';
import { createRouter, createWebHashHistory } from 'vue-router';
import { TailWatch } from '@tailwatch/vue';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: { template: '<h1>Home</h1>' } },
    { path: '/about', component: { template: '<h1>About</h1>' } },
    { path: '/blog/:slug', component: { template: `<h1>Post</h1><button @click="$tw.track('signup', { plan: 'pro' })">Sign up</button>` } },
  ],
});

createApp({
  template: `<nav><router-link to="/">Home</router-link> <router-link to="/about">About</router-link> <router-link to="/blog/hello">Blog</router-link></nav><router-view />`,
})
  .use(router)
  .use(TailWatch, { key: import.meta.env.VITE_TW_KEY, api: import.meta.env.VITE_TW_API, hashRouting: true, allowLocal: import.meta.env.VITE_TW_ALLOW_LOCAL === '1' })
  .mount('#app');
