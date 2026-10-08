// Builds the tracker and enforces the size budget (invariant 13: the build FAILS over budget).
//   dist/cdn/tw.js     IIFE for the script tag, served by the collector (Workers static assets)
//   dist/cdn/_headers  cache headers for it
//   dist/npm/index.js  ESM for bundlers (npm channel)
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** PLAN 4 invariant 13: <= 3 KB on the wire (gzip). */
export const BUDGET_BYTES = 3072;

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = `${root}dist`;
rmSync(dist, { recursive: true, force: true });
mkdirSync(`${dist}/cdn`, { recursive: true });

const common = {
  bundle: true,
  minify: true,
  target: 'es2018', // Safari 12 / Chrome 64 era: no optional chaining or ?? in the output
  legalComments: 'none',
  absWorkingDir: root,
  logLevel: 'warning',
};

await build({ ...common, entryPoints: ['src/cdn.ts'], outfile: 'dist/cdn/tw.js', format: 'iife' });
await build({ ...common, entryPoints: ['src/index.ts'], outfile: 'dist/npm/index.js', format: 'esm', minify: false });

// One hour fresh, a day stale-while-revalidate: a fix reaches every site within the hour, and the
// wire is append-only (invariant 7), so an old cached copy is still a valid client.
writeFileSync(
  `${dist}/cdn/_headers`,
  ['/tw.js', '  Cache-Control: public, max-age=3600, stale-while-revalidate=86400', '  Access-Control-Allow-Origin: *', ''].join('\n'),
);

let failed = false;
for (const file of ['cdn/tw.js', 'npm/index.js']) {
  const src = readFileSync(`${dist}/${file}`);
  const gz = gzipSync(src, { level: 9 }).byteLength;
  const over = file === 'cdn/tw.js' && gz > BUDGET_BYTES;
  failed ||= over;
  console.log(`${file.padEnd(14)} ${String(src.byteLength).padStart(6)} B raw  ${String(gz).padStart(5)} B gzip${file === 'cdn/tw.js' ? `  (budget ${BUDGET_BYTES})` : ''}${over ? '  OVER BUDGET' : ''}`);
}
if (failed) {
  console.error(`tw.js is over the ${BUDGET_BYTES} B gzip budget (PLAN invariant 13). The build fails.`);
  process.exitCode = 1;
}
