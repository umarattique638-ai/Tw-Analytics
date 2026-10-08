import { defineConfig } from 'vite';

// No .vue files: templates are compiled at runtime (vue/dist/vue.esm-bundler.js), so no plugin needed.
export default defineConfig({
  resolve: { alias: { vue: 'vue/dist/vue.esm-bundler.js' } }
});
