import { existsSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { chromium } from 'playwright-core';
import type { Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { defaultConfig } from '../../src/config';
import { MemoryKv } from '../../src/repositories/kv';
import { MemoryMailer } from '../../src/services/mail';
import { MemoryStore } from '../../src/repositories/memory-store';

/**
 * Decision 27 in the browser: a new account confirms its e-mail before it can log in, and "Forgot
 * password" refuses an address without an account. Built dashboard (apps/web/dist) + the real API with
 * in-memory stores and a mailer that keeps what it sends.
 */
const WEB = fileURLToPath(new URL('../../../web/dist/', import.meta.url));
const SHOTS = process.env.TW_SCREENSHOTS;
const PASSWORD = 'correct horse battery';

let api: ServerType;
let base: string;
let browser: Browser;
const mailer = new MemoryMailer();

beforeAll(async () => {
  if (!existsSync(`${WEB}index.html`)) throw new Error('Build the dashboard first: pnpm --filter @tailwatch/web build');
  const server = new Hono();
  // publicUrl is set once the port is known: the e-mailed links must point at this server.
  const config = defaultConfig({ collectorUrl: 'https://collector.test', secureCookies: false, scrypt: { N: 1024, r: 8, p: 1 }, requireEmailVerification: true });
  server.route('/', createApp({ store: new MemoryStore(), kv: new MemoryKv(), mailer, analytics: { recent: async () => ({ events: 0, pageviews: 0, last: null, drops: [] }) }, config }));
  const index = readFileSync(`${WEB}index.html`, 'utf8');
  server.use('/*', serveStatic({ root: relative(process.cwd(), WEB) }));
  server.get('*', (c) => c.html(index));
  await new Promise<void>((r) => (api = serve({ fetch: server.fetch, port: 0, hostname: '127.0.0.1' }, () => r())));
  base = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  config.publicUrl = base;
  browser = await chromium.launch({ executablePath: process.env.TW_CHROME_PATH || undefined });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await new Promise((r) => (api ? api.close(r) : r(undefined)));
});

const lastLink = (kind: 'verify-email' | 'reset-password') => {
  const m = new RegExp(`(https?://[^\\s]+/${kind}\\?token=[A-Za-z0-9_-]+)`).exec(mailer.sent.at(-1)!.text);
  return m![1]!;
};

describe('e-mail verification and forgot password, in Chromium', { timeout: 60_000 }, () => {
  it('sign up -> check your inbox -> log in refused -> send again -> open the link -> Log in page -> signed in', async () => {
    const page = await (await browser.newContext()).newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(`${base}/signup`);
    await page.getByLabel('Full name').fill('Ali Raza');
    await page.getByLabel('Work email').fill('ali@shop.test');
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Confirm password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.getByTestId('verify-sent').waitFor();
    expect(await page.getByText('ali@shop.test').first().isVisible()).toBe(true);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/a1-check-inbox.png`, fullPage: true });
    expect(mailer.sent.at(-1)!.subject).toBe('Confirm your e-mail for TailWatch');
    const first = lastLink('verify-email');

    // Log in before confirming: refused, with "Send it again".
    await page.goto(`${base}/login`);
    await page.getByLabel('Work email').fill('ali@shop.test');
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.getByText('Confirm your e-mail first').waitFor();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/a2-login-unverified.png`, fullPage: true });
    await page.getByRole('button', { name: 'Send it again' }).click();
    await page.getByText('A new link is on its way').waitFor();
    const second = lastLink('verify-email');
    expect(second).not.toBe(first);

    // The old link no longer works; the new one confirms, then Log in opens (no automatic sign-in).
    await page.goto(first);
    await page.getByTestId('email-verify-invalid').waitFor();
    await page.goto(second);
    await page.getByTestId('email-verified').waitFor();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/a3-verified.png`, fullPage: true });
    await page.waitForURL('**/login', { timeout: 10_000 });
    await page.getByText('E-mail confirmed. Log in with your password to continue.').waitFor();
    expect(await page.getByLabel('Work email').inputValue()).toBe('ali@shop.test');
    expect((await page.request.get(`${base}/api/v1/me`)).status()).toBe(401); // not signed in by the link
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/a3b-login-after-verify.png`, fullPage: true });
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.waitForURL(/\/(dashboard|sites\/new)/, { timeout: 10_000 });
    expect(errors).toEqual([]);
  });

  it('forgot password: an address without an account is refused; a real one gets the link', async () => {
    const page = await (await browser.newContext()).newPage();
    await page.goto(`${base}/forgot-password`);
    await page.getByLabel('Work email').fill('nobody@shop.test');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await page.getByText('No account uses this e-mail').waitFor();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/a4-forgot-unknown.png`, fullPage: true });

    await page.getByLabel('Work email').fill('ali@shop.test');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await page.getByTestId('reset-sent').waitFor();
    expect(lastLink('reset-password')).toContain('/reset-password?token=');
  });
});
