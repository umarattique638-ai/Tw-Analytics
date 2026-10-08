// Bundles the API into one file (dist/server.mjs) so it runs with plain `node`, on Windows too.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
await build({
  absWorkingDir: root,
  entryPoints: ['src/server.ts'],
  outfile: 'dist/server.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // npm packages stay in node_modules; workspace code (@tailwatch/contract, TypeScript) is bundled in.
  external: ['mongodb', 'hono', 'hono/*', '@hono/*'],
  logLevel: 'warning',
  banner: { js: '// Built by apps/api/scripts/build.mjs. Do not edit.' },
});
console.log('dist/server.mjs built');
