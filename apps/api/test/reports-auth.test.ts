import { describe, expect, it } from 'vitest';
import { EXPORT_KEEP_DAYS, RESET_MINUTES, SESSION_COOKIE, createApp } from '../src/app';
import { defaultConfig } from '../src/config';
import { MemoryKv } from '../src/models/kv';
import { MemoryMailer, UnconfiguredMailer, parseFrom, resetPasswordMail } from '../src/services/mail';
import type { Mailer } from '../src/services/mail';
import type { Overview, StatsReader } from '../src/models/stats';
import { resolveRange } from '../src/models/stats';
import { MemoryStore } from '../src/models/memory-store';
import { addSite, fakeVerifier } from './helpers/install';

/** Reports (saved exports, 90-day expiry) and forgot / reset password, over HTTP. */
let clock = new Date('2026-10-08T10:00:00Z');

const stats = {
  overview: async (_site: number, range: ReturnType<typeof resolveRange>): Promise<Overview> => ({
    range,
    kpis: { visitors: 4, visitorsEstimated: false, sessions: 4, pageviews: 6, bounceRate: 0.5, previous: { visitors: 1, sessions: 0, pageviews: 1, bounceRate: null } },
    series: range.hourly
      ? [{ bucket: String(Date.UTC(2026, 9, 8, 4) / 1000), label: '09:00', visitors: 2, sessions: 2, pageviews: 3 }]
      : [
          { bucket: '2026-10-07', label: 'Oct 7', visitors: 1, sessions: 0, pageviews: 1 },
          { bucket: '2026-10-08', label: 'Oct 8', visitors: 4, sessions: 4, pageviews: 6 },
        ],
    sources: [], referrers: [], pages: [], countries: [], devices: [], browsers: [],
    capture: { received: 9, expected: 10, rate: 0.9 }, drops: [],
  }),
} as unknown as StatsReader;

async function setup(mailer: Mailer = new MemoryMailer(), over: Partial<Parameters<typeof defaultConfig>[0]> = {}) {
  clock = new Date('2026-10-08T10:00:00Z');
  const store = new MemoryStore();
  const kv = new MemoryKv();
  const app = createApp({
    store,
    kv,
    verifier: fakeVerifier(kv.entries, 'https://c.test'),
    analytics: { recent: async () => ({ events: 0, pageviews: 0, last: null, drops: [] }) },
    stats,
    mailer,
    config: defaultConfig({ collectorUrl: 'https://c.test', secureCookies: false, scrypt: { N: 1024, r: 8, p: 1 }, publicUrl: 'https://dash.test', ...over }),
    now: () => clock,
  });
  const client = () => {
    let cookie = '';
    return async (method: string, path: string, json?: unknown) => {
      const res = await app.request(`http://app.test/api/v1${path}`, {
        method,
        headers: { host: 'app.test', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: json === undefined ? undefined : JSON.stringify(json),
      });
      const set = res.headers.get('set-cookie');
      if (set?.startsWith(`${SESSION_COOKIE}=`)) cookie = set.split(';')[0]!;
      const text = await res.text();
      let body: any = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      return { status: res.status, type: res.headers.get('content-type') ?? '', disposition: res.headers.get('content-disposition') ?? '', text, body };
    };
  };
  const a = client();
  const signedUp = await a('POST', '/auth/signup', { name: 'Umar', email: 'umar@x.co', password: 'correct horse' });
  if (signedUp.body.verificationRequired) {
    // Open the e-mailed link in this browser (decision 27), then the mail list starts empty for the test.
    const token = /verify-email\?token=([A-Za-z0-9_-]+)/.exec((mailer as MemoryMailer).sent.at(-1)!.text)![1]!;
    await a('POST', '/auth/verify-email', { token });
    await a('POST', '/auth/login', { email: 'umar@x.co', password: 'correct horse' });
    (mailer as MemoryMailer).sent.length = 0;
  }
  const site = (await addSite((p, j) => a('POST', p, j), kv.entries, 'shop.example.com', 'Asia/Karachi')).body.site;
  return { a, client, site, store, mailer };
}

describe('Reports: every export is saved, can be downloaded again and deleted, and expires after 90 days', () => {
  it('make -> listed -> download the same CSV -> delete', async () => {
    const { a, site } = await setup();
    expect((await a('GET', `/sites/${site.id}/exports`)).body).toEqual({ keepDays: 90, max: 200, exports: [] });

    const made = await a('POST', `/sites/${site.id}/exports`, { range: '7d' });
    expect(made.status).toBe(201);
    expect(made.body.export).toMatchObject({
      range: '7d',
      from: '2026-10-02',
      to: '2026-10-08',
      timezone: 'Asia/Karachi',
      filename: 'shop.example.com-2026-10-02-2026-10-08.csv',
      rows: 2,
      createdAt: '2026-10-08T10:00:00.000Z',
      expiresAt: '2027-01-06T10:00:00.000Z',
    });
    expect(made.body.export.bytes).toBe(Buffer.byteLength('date,visitors,sessions,pageviews\n2026-10-07,1,0,1\n2026-10-08,4,4,6\n'));
    expect(made.body.export).not.toHaveProperty('csv');

    clock = new Date('2026-10-08T11:00:00Z');
    expect((await a('POST', `/sites/${site.id}/exports`, { range: 'today' })).text).toContain('"today"');
    const list = (await a('GET', `/sites/${site.id}/exports`)).body.exports;
    expect(list.map((e: { range: string }) => e.range)).toEqual(['today', '7d']); // newest first

    const id = made.body.export.id;
    const dl = await a('GET', `/sites/${site.id}/exports/${id}/download`);
    expect(dl.type).toContain('text/csv');
    expect(dl.disposition).toBe('attachment; filename="shop.example.com-2026-10-02-2026-10-08.csv"');
    expect(dl.text).toBe('date,visitors,sessions,pageviews\n2026-10-07,1,0,1\n2026-10-08,4,4,6\n');

    expect((await a('DELETE', `/sites/${site.id}/exports/${id}`, {})).body).toEqual({ ok: true });
    expect((await a('GET', `/sites/${site.id}/exports/${id}/download`)).status).toBe(404);
    expect((await a('DELETE', `/sites/${site.id}/exports/${id}`, {})).status).toBe(404);
    expect((await a('GET', `/sites/${site.id}/exports`)).body.exports).toHaveLength(1);
  });

  it(`gone after ${EXPORT_KEEP_DAYS} days, even before MongoDB's TTL monitor removes the document`, async () => {
    const { a, site } = await setup();
    const id = (await a('POST', `/sites/${site.id}/exports`, { range: '30d' })).body.export.id;
    clock = new Date(clock.getTime() + (EXPORT_KEEP_DAYS * 86_400_000 - 1000));
    expect((await a('GET', `/sites/${site.id}/exports`)).body.exports).toHaveLength(1);
    clock = new Date(clock.getTime() + 2000);
    expect((await a('GET', `/sites/${site.id}/exports`)).body.exports).toEqual([]);
    expect((await a('GET', `/sites/${site.id}/exports/${id}/download`)).status).toBe(404);
  });

  it('another account cannot list, download or delete them; bad input is refused', async () => {
    const { a, client, site } = await setup();
    const id = (await a('POST', `/sites/${site.id}/exports`, { range: '7d' })).body.export.id;
    const b = client();
    await b('POST', '/auth/signup', { name: 'B', email: 'b@x.co', password: 'correct horse' });
    expect((await b('GET', `/sites/${site.id}/exports`)).status).toBe(404);
    expect((await b('GET', `/sites/${site.id}/exports/${id}/download`)).status).toBe(404);
    expect((await b('DELETE', `/sites/${site.id}/exports/${id}`, {})).status).toBe(404);
    expect((await a('POST', `/sites/${site.id}/exports`, { range: 'forever' })).status).toBe(400);
    expect((await a('GET', `/sites/${site.id}/exports/not-an-id/download`)).status).toBe(404);
    expect((await client()('GET', `/sites/${site.id}/exports`)).status).toBe(401);
  });
});

describe('Forgot password', () => {
  it('e-mails a one-time link; the new password works, the old one and every old session do not', async () => {
    const { a, client, mailer } = await setup();
    const other = client(); // a second device, signed in
    expect((await other('POST', '/auth/login', { email: 'umar@x.co', password: 'correct horse' })).status).toBe(200);

    const anon = client();
    const r = await anon('POST', '/auth/forgot', { email: 'UMAR@x.co' });
    expect(r.body).toEqual({ ok: true, minutes: RESET_MINUTES });
    const sent = (mailer as MemoryMailer).sent;
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('umar@x.co');
    const link = /https:\/\/dash\.test\/reset-password\?token=([A-Za-z0-9_-]+)/.exec(sent[0]!.text);
    expect(link).not.toBeNull();
    const token = link![1]!;
    expect(sent[0]!.html).toContain(`https://dash.test/reset-password?token=${token}`);

    expect((await anon('GET', `/auth/reset?token=${token}`)).body).toEqual({ valid: true });
    expect((await anon('POST', '/auth/reset', { token, password: 'short' })).status).toBe(400);
    const done = await anon('POST', '/auth/reset', { token, password: 'a brand new password' });
    expect(done.status).toBe(200);
    expect(done.body.user.email).toBe('umar@x.co');
    expect((await anon('GET', '/me')).status).toBe(200); // signed in right away

    // every session from before is gone, on every device
    expect((await a('GET', '/me')).status).toBe(401);
    expect((await other('GET', '/me')).status).toBe(401);
    // one use only
    expect((await anon('GET', `/auth/reset?token=${token}`)).body).toEqual({ valid: false });
    expect((await client()('POST', '/auth/reset', { token, password: 'another new password' })).body.error).toBe('reset_invalid');

    const fresh = client();
    expect((await fresh('POST', '/auth/login', { email: 'umar@x.co', password: 'correct horse' })).status).toBe(401);
    expect((await fresh('POST', '/auth/login', { email: 'umar@x.co', password: 'a brand new password' })).status).toBe(200);
  });

  it(`the link expires after ${RESET_MINUTES} minutes`, async () => {
    const { client, mailer } = await setup();
    const anon = client();
    await anon('POST', '/auth/forgot', { email: 'umar@x.co' });
    const token = /token=([A-Za-z0-9_-]+)/.exec((mailer as MemoryMailer).sent[0]!.text)![1]!;
    clock = new Date(clock.getTime() + RESET_MINUTES * 60_000 + 1);
    expect((await anon('GET', `/auth/reset?token=${token}`)).body).toEqual({ valid: false });
    expect((await anon('POST', '/auth/reset', { token, password: 'a brand new password' })).body.error).toBe('reset_invalid');
  });

  it('an e-mail without an account is told so (owner decision 2026-10-15) and gets no e-mail; requests are limited per address', async () => {
    const { client, mailer } = await setup();
    const anon = client();
    const unknown = await anon('POST', '/auth/forgot', { email: 'nobody@x.co' });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toBe('email_not_found');
    expect(unknown.body.message).toContain('No account uses this e-mail');
    expect((mailer as MemoryMailer).sent).toHaveLength(0);
    expect((await anon('POST', '/auth/forgot', { email: 'not an email' })).status).toBe(400);
    for (let i = 0; i < 3; i++) expect((await anon('POST', '/auth/forgot', { email: 'umar@x.co' })).status).toBe(200);
    expect((await anon('POST', '/auth/forgot', { email: 'umar@x.co' })).status).toBe(429);
    expect((mailer as MemoryMailer).sent).toHaveLength(3);
  }, 15_000);

  it('without an e-mail service the server says so (503), it never pretends to send', async () => {
    const { client } = await setup(new UnconfiguredMailer());
    const r = await client()('POST', '/auth/forgot', { email: 'umar@x.co' });
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('reset_unavailable');
  });

  it('mail helpers: sender parsing, and the link is in both the text and the HTML', () => {
    expect(parseFrom('TailWatch <me@gmail.com>')).toEqual({ name: 'TailWatch', email: 'me@gmail.com' });
    expect(parseFrom('me@gmail.com')).toEqual({ name: 'TailWatch', email: 'me@gmail.com' });
    const m = resetPasswordMail('me@gmail.com', 'Umar <b>', 'https://d.test/reset-password?token=abc', 60);
    expect(m.text).toContain('https://d.test/reset-password?token=abc');
    expect(m.html).toContain('Umar &lt;b&gt;');
    expect(m.html).not.toContain('Umar <b>');
  });
});

describe('E-mail verification (decision 27): a new account logs in only after opening the e-mailed link', () => {
  const VERIFY = { requireEmailVerification: true };
  const linkIn = (mailer: Mailer, i = -1) => /https:\/\/dash\.test\/verify-email\?token=([A-Za-z0-9_-]+)/.exec((mailer as MemoryMailer).sent.at(i)!.text)![1]!;

  it('sign up -> no session, an e-mail with a link; log in refused until the link is opened; the link confirms (no sign-in), once', async () => {
    const { client, mailer, store } = await setup(new MemoryMailer(), VERIFY);
    const c = client();
    const r = await c('POST', '/auth/signup', { name: 'Ali', email: 'Ali@x.co', password: 'correct horse' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ verificationRequired: true, email: 'Ali@x.co', sent: true, hours: 24 });
    expect((await c('GET', '/me')).status).toBe(401); // no session yet
    const mail = (mailer as MemoryMailer).sent.at(-1)!;
    expect(mail.to).toBe('Ali@x.co');
    expect(mail.subject).toBe('Confirm your e-mail for TailWatch');
    const token = linkIn(mailer);
    expect(mail.html).toContain(`https://dash.test/verify-email?token=${token}`);
    expect(store.users.find((u) => u.email === 'Ali@x.co')!.emailVerifiedAt).toBeNull();

    const refused = await client()('POST', '/auth/login', { email: 'ali@x.co', password: 'correct horse' });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe('email_unverified');
    // A wrong password never says whether the address is verified.
    expect((await client()('POST', '/auth/login', { email: 'ali@x.co', password: 'wrong horse!' })).body.error).toBe('invalid_credentials');

    const v = client();
    const ok = await v('POST', '/auth/verify-email', { token });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true, email: 'Ali@x.co' });
    expect((await v('GET', '/me')).status).toBe(401);
    expect(store.users.find((u) => u.email === 'Ali@x.co')!.emailVerifiedAt).toBeInstanceOf(Date);
    expect((await client()('POST', '/auth/verify-email', { token })).body.error).toBe('verify_invalid'); // one use
    expect((await client()('POST', '/auth/login', { email: 'ali@x.co', password: 'correct horse' })).status).toBe(200);
    expect(store.audit.some((e) => e.action === 'auth.email_verified')).toBe(true);
  });

  it('the link expires after 24 hours', async () => {
    const { client, mailer } = await setup(new MemoryMailer(), VERIFY);
    await client()('POST', '/auth/signup', { name: 'Ali', email: 'ali@x.co', password: 'correct horse' });
    const token = linkIn(mailer);
    clock = new Date(clock.getTime() + 24 * 3_600_000 + 1);
    expect((await client()('POST', '/auth/verify-email', { token })).body.error).toBe('verify_invalid');
  });

  it('send the link again: needs the password, replaces the old link, and is limited', async () => {
    const { client, mailer } = await setup(new MemoryMailer(), VERIFY);
    await client()('POST', '/auth/signup', { name: 'Ali', email: 'ali@x.co', password: 'correct horse' });
    const first = linkIn(mailer);
    const anon = client();
    expect((await anon('POST', '/auth/resend-verification', { email: 'ali@x.co', password: 'nope nope' })).status).toBe(401);
    const again = await anon('POST', '/auth/resend-verification', { email: 'ali@x.co', password: 'correct horse' });
    expect(again.body).toMatchObject({ ok: true, hours: 24 });
    const second = linkIn(mailer);
    expect(second).not.toBe(first);
    expect((await client()('POST', '/auth/verify-email', { token: first })).body.error).toBe('verify_invalid');
    expect((await anon('POST', '/auth/resend-verification', { email: 'ali@x.co', password: 'correct horse' })).status).toBe(200);
    expect((await anon('POST', '/auth/resend-verification', { email: 'ali@x.co', password: 'correct horse' })).status).toBe(429);
    expect((await client()('POST', '/auth/verify-email', { token: linkIn(mailer) })).status).toBe(200);
  }, 15_000);

  it('a password reset link proves the address too', async () => {
    const { client, mailer, store } = await setup(new MemoryMailer(), VERIFY);
    await client()('POST', '/auth/signup', { name: 'Ali', email: 'ali@x.co', password: 'correct horse' });
    await client()('POST', '/auth/forgot', { email: 'ali@x.co' });
    const token = /reset-password\?token=([A-Za-z0-9_-]+)/.exec((mailer as MemoryMailer).sent.at(-1)!.text)![1]!;
    expect((await client()('POST', '/auth/reset', { token, password: 'a new password' })).status).toBe(200);
    expect(store.users.find((u) => u.email === 'ali@x.co')!.emailVerifiedAt).toBeInstanceOf(Date);
    expect((await client()('POST', '/auth/login', { email: 'ali@x.co', password: 'a new password' })).status).toBe(200);
  });

  it('without an e-mail service nobody is locked out: sign-up logs in at once', async () => {
    const { client } = await setup(new UnconfiguredMailer(), VERIFY);
    const c = client();
    const r = await c('POST', '/auth/signup', { name: 'Ali', email: 'ali@x.co', password: 'correct horse' });
    expect(r.body.verificationRequired).toBeUndefined();
    expect((await c('GET', '/me')).status).toBe(200);
  });

  it('accounts made before verification existed (no emailVerifiedAt) log in as before', async () => {
    const { client, store } = await setup(new MemoryMailer(), VERIFY);
    delete store.users.find((u) => u.email === 'umar@x.co')!.emailVerifiedAt;
    expect((await client()('POST', '/auth/login', { email: 'umar@x.co', password: 'correct horse' })).status).toBe(200);
  });
});
