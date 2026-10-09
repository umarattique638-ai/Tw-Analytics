import { describe, expect, it } from 'vitest';
import { EXPORT_KEEP_DAYS, RESET_MINUTES, SESSION_COOKIE, createApp } from '../src/app';
import { defaultConfig } from '../src/config';
import { MemoryKv } from '../src/kv';
import { MemoryMailer, UnconfiguredMailer, parseFrom, resetPasswordMail } from '../src/mail';
import type { Mailer } from '../src/mail';
import type { Overview, StatsReader } from '../src/stats';
import { resolveRange } from '../src/stats';
import { MemoryStore } from '../src/store/memory';

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

async function setup(mailer: Mailer = new MemoryMailer()) {
  clock = new Date('2026-10-08T10:00:00Z');
  const store = new MemoryStore();
  const app = createApp({
    store,
    kv: new MemoryKv(),
    analytics: { recent: async () => ({ events: 0, pageviews: 0, last: null, drops: [] }) },
    stats,
    mailer,
    config: defaultConfig({ collectorUrl: 'https://c.test', secureCookies: false, scrypt: { N: 1024, r: 8, p: 1 }, publicUrl: 'https://dash.test' }),
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
  await a('POST', '/auth/signup', { name: 'Umar', email: 'umar@x.co', password: 'correct horse' });
  const site = (await a('POST', '/sites', { domain: 'shop.example.com', timezone: 'Asia/Karachi' })).body.site;
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

  it('an unknown e-mail gets the same answer and no e-mail; requests are limited per address', async () => {
    const { client, mailer } = await setup();
    const anon = client();
    expect((await anon('POST', '/auth/forgot', { email: 'nobody@x.co' })).body).toEqual({ ok: true, minutes: RESET_MINUTES });
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
