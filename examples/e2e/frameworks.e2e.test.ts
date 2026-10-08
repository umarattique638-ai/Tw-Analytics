import { spawn, execFileSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BROWSER_UA, LOCAL_KEY, startStack, wait } from '../../apps/collector/test/e2e/harness';
import type { Stack } from '../../apps/collector/test/e2e/harness';

/**
 * Stage 4 done-when (BUILD-ORDER / PLAN Phase 4 exit test):
 *   "a Next.js App Router app, a Vite SPA and a hash-router app each record exactly one pageview per
 *    navigation including the first, and survive React StrictMode in dev."
 *
 * Each example app runs as a real DEV server (StrictMode double effects are a dev-only behaviour),
 * opened in Chromium as http://<app>.localhost:<port> (as a developer would), sending to the collector
 * on workerd. The apps set allowLocal from TW_ALLOW_LOCAL, because the tracker skips localhost by default.
 * The same user journey is walked in every app:
 *   load Home -> About -> Blog post -> click Sign up -> browser Back (to About)
 * and must produce exactly: 4 pageviews (first one flagged) + 1 signup, nothing else.
 *
 * Run: pnpm e2e:frameworks   (needs the Chromium from `playwright-core install chromium`)
 */

const root = fileURLToPath(new URL('..', import.meta.url));
let stack: Stack;
const servers: ChildProcess[] = [];

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

/** node <package bin>, so it works the same on Windows and Linux (no .cmd shims). */
function bin(appDir: string, pkg: string, file: string): string {
  const req = createRequire(join(appDir, 'package.json'));
  return join(dirname(req.resolve(`${pkg}/package.json`)), file);
}

async function startApp(dir: string, args: (port: number) => string[], pkg: string, file: string, env: Record<string, string>) {
  const port = await freePort();
  const cwd = join(root, dir);
  const child = spawn(process.execPath, [bin(cwd, pkg, file), ...args(port)], {
    cwd,
    env: { ...process.env, ...env, NEXT_TELEMETRY_DISABLED: '1', BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  let log = '';
  child.stdout!.on('data', (d) => (log += d));
  child.stderr!.on('data', (d) => (log += d));
  servers.push(child);
  const started = Date.now();
  for (;;) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/`);
      if (r.status < 500) return port;
    } catch {
      // not listening yet
    }
    if (child.exitCode !== null || Date.now() - started > 120_000) throw new Error(`${dir} did not start:\n${log}`);
    await wait(300);
  }
}

function stop(child: ChildProcess) {
  if (child.exitCode !== null || !child.pid) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGTERM'); // the whole group: Next starts worker processes
  } catch {
    // already gone
  }
}

/** The same journey in every app. `route` maps a path to what the app stores (hash apps: /#/x). */
async function journey(host: string, port: number, route: (p: string) => string, flagsFirst: number, flagsNext: number, init?: string) {
  await stack.clear();
  const context = await stack.browser.newContext({ userAgent: BROWSER_UA });
  const page = await context.newPage();
  if (init) await page.addInitScript(init);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const heading = (name: string) => page.getByRole('heading', { name, exact: true }).waitFor({ timeout: 90_000 });
  await page.goto(`http://${host}:${port}/`, { timeout: 120_000 });
  await heading('Home');
  await stack.events(1);
  await page.getByRole('link', { name: 'About', exact: true }).click();
  await heading('About');
  await wait(150);
  await page.getByRole('link', { name: 'Blog', exact: true }).click();
  await page.getByRole('button', { name: 'Sign up' }).waitFor({ timeout: 90_000 });
  await wait(150);
  await page.getByRole('button', { name: 'Sign up' }).click();
  await wait(150);
  await page.goBack();
  await heading('About');
  const got = await stack.events(5, 1500);
  await context.close();

  expect(errors).toEqual([]);
  expect(await stack.drops()).toEqual([]);
  expect(got.map((e) => [e.name, e.path, e.flags])).toEqual([
    ['pageview', route('/'), flagsFirst],
    ['pageview', route('/about'), flagsNext],
    ['pageview', route('/blog/hello'), flagsNext],
    ['signup', route('/blog/hello'), flagsNext],
    ['pageview', route('/about'), flagsNext],
  ]);
  expect(got.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]); // one page load, nothing lost
  expect(got[3]!.props).toEqual({ plan: 'pro' });
}

beforeAll(async () => {
  stack = await startStack();
}, 240_000);

afterAll(async () => {
  servers.forEach(stop);
  await stack?.close();
});

describe('Stage 4 done-when: framework apps in dev mode (StrictMode on)', () => {
  it('Next.js App Router (@tailwatch/next)', async () => {
    const port = await startApp('next-app', (p) => ['dev', '-H', '127.0.0.1', '-p', String(p)], 'next', 'dist/bin/next', {
      NEXT_PUBLIC_TW_KEY: LOCAL_KEY,
      NEXT_PUBLIC_TW_API: `${stack.collector}/e`,
      NEXT_PUBLIC_TW_ALLOW_LOCAL: '1',
    });
    await journey('next.localhost', port, (p) => p, 1, 0);
    // Same server, browsers without the Navigation API (core falls back to patching pushState, which
    // Next's router also wraps): still exactly one pageview per navigation.
    await journey('next.localhost', port, (p) => p, 1, 0, 'Object.defineProperty(window, "navigation", { value: undefined });');
  });

  it('Vite SPA with React Router + StrictMode (@tailwatch/react)', async () => {
    const port = await startApp('vite-react', (p) => ['--host', '127.0.0.1', '--port', String(p), '--strictPort'], 'vite', 'bin/vite.js', {
      VITE_TW_KEY: LOCAL_KEY,
      VITE_TW_API: `${stack.collector}/e`,
      VITE_TW_ALLOW_LOCAL: '1',
    });
    await journey('vite.localhost', port, (p) => p, 1, 0);
  });

  it('hash-router app: Vue + createWebHashHistory (@tailwatch/vue, hashRouting)', async () => {
    const port = await startApp('vue-hash', (p) => ['--host', '127.0.0.1', '--port', String(p), '--strictPort'], 'vite', 'bin/vite.js', {
      VITE_TW_KEY: LOCAL_KEY,
      VITE_TW_API: `${stack.collector}/e`,
      VITE_TW_ALLOW_LOCAL: '1',
    });
    await journey('hash.localhost', port, (p) => `/#${p}`, 3, 2);
  });
});
