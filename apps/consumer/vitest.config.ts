import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Loads the repository-root .env (TW_CH_URL, TW_CH_USER, TW_CH_PASSWORD, ...) for the live and e2e suites.
    setupFiles: ['./test/setup-env.ts'],
  },
});
