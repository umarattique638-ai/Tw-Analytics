// Builds the Vercel deployment (Build Output API v3) at the repository root: .vercel/output
//   static/                the dashboard (apps/web/dist), served by Vercel's CDN
//   functions/api.func/    the API (src/vercel.ts) bundled into one file, Node 22
//   config.json            /api/* -> the function; everything else -> the dashboard (SPA fallback)
// Run after `pnpm --filter @tailwatch/web build`. Vercel runs both (vercel.json buildCommand).
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const api = fileURLToPath(new URL('..', import.meta.url));
const web = fileURLToPath(new URL('../../web/dist/', import.meta.url));
const out = fileURLToPath(new URL('../../../.vercel/output/', import.meta.url));

if (!existsSync(`${web}index.html`)) {
  console.error('apps/web/dist is missing: run `pnpm --filter @tailwatch/web build` first.');
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}functions/api.func`, { recursive: true });
cpSync(web, `${out}static`, { recursive: true });

await build({
  absWorkingDir: api,
  entryPoints: ['src/vercel.ts'],
  outfile: `${out}functions/api.func/index.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // The MongoDB driver's OPTIONAL extras (Kerberos, compression, AWS/GCP auth, client-side encryption).
  // Not used; the driver loads them inside try/catch, so leaving them out is safe.
  external: ['kerberos', '@mongodb-js/zstd', 'snappy', '@aws-sdk/credential-providers', 'gcp-metadata', 'socks', 'aws4', 'mongodb-client-encryption'],
  // CommonJS packages bundled into ESM still call require(): give them one.
  banner: { js: "// Built by apps/api/scripts/build-vercel.mjs. Do not edit.\nimport { createRequire as __twCreateRequire } from 'node:module';\nconst require = __twCreateRequire(import.meta.url);" },
  logLevel: 'warning',
});

writeFileSync(
  `${out}functions/api.func/.vc-config.json`,
  JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 30 }, null, 2),
);

writeFileSync(
  `${out}config.json`,
  JSON.stringify(
    {
      version: 3,
      routes: [
        // Every API path goes to the one function, which puts the original path back (src/vercel.ts).
        { src: '^/api/(.*)$', dest: '/api?__path=/api/$1' },
        { handle: 'filesystem' },
        // Dashboard routes (/login, /sites/101, ...) are client-side: serve index.html.
        { src: '^/(.*)$', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
);
console.log('.vercel/output built (static dashboard + api function)');
