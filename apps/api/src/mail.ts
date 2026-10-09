/**
 * Outgoing e-mail (password reset; later digests and invites). Free providers only, over plain HTTPS:
 *
 *   TW_BREVO_API_KEY   Brevo (free: 300 e-mails a day, no card). The sender address in TW_MAIL_FROM must
 *                      be verified in Brevo (Senders), a Gmail address works.
 *   TW_RESEND_API_KEY  Resend (free: 3,000 a month). Without your own domain it only delivers to your own
 *                      Resend login address, so Brevo is the default choice until there is a domain.
 *   TW_MAIL_FROM       "TailWatch <you@example.com>" or just the address.
 *
 * Neither set: on your own computer the message is printed in the terminal (so the reset link still
 * works locally); on a public server password reset says it is not set up, instead of failing silently.
 */

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  /** False when nothing can be sent: the API answers "not set up" instead of pretending. */
  readonly configured: boolean;
  send(message: MailMessage): Promise<void>;
}

type Env = Record<string, string | undefined>;

export function parseFrom(raw: string): { name: string; email: string } {
  const m = /^\s*(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(raw);
  if (m) return { name: m[1]!.replace(/^"|"$/g, '') || 'TailWatch', email: m[2]! };
  return { name: 'TailWatch', email: raw.trim() };
}

async function post(url: string, headers: Record<string, string>, body: unknown, fetchImpl: typeof fetch, provider: string) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`${provider} ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

export class BrevoMailer implements Mailer {
  readonly configured = true;
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  async send(m: MailMessage) {
    await post(
      'https://api.brevo.com/v3/smtp/email',
      { 'api-key': this.apiKey },
      { sender: parseFrom(this.from), to: [{ email: m.to }], subject: m.subject, textContent: m.text, htmlContent: m.html },
      this.fetchImpl,
      'Brevo',
    );
  }
}

export class ResendMailer implements Mailer {
  readonly configured = true;
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  async send(m: MailMessage) {
    const f = parseFrom(this.from);
    await post(
      'https://api.resend.com/emails',
      { authorization: `Bearer ${this.apiKey}` },
      { from: `${f.name} <${f.email}>`, to: [m.to], subject: m.subject, text: m.text, html: m.html },
      this.fetchImpl,
      'Resend',
    );
  }
}

/** Local development: the message goes to the terminal. Never used on a public server. */
export class ConsoleMailer implements Mailer {
  readonly configured = true;
  async send(m: MailMessage) {
    console.log(`\n--- e-mail to ${m.to}: ${m.subject}\n${m.text}\n---\n`);
  }
}

export class UnconfiguredMailer implements Mailer {
  readonly configured = false;
  async send(): Promise<void> {
    throw new Error('E-mail is not configured: set TW_BREVO_API_KEY (or TW_RESEND_API_KEY) and TW_MAIL_FROM.');
  }
}

/** Test double: keeps every message. */
export class MemoryMailer implements Mailer {
  readonly configured = true;
  readonly sent: MailMessage[] = [];
  async send(m: MailMessage) {
    this.sent.push(m);
  }
}

export function mailerFromEnv(env: Env, hosted: boolean): Mailer {
  const from = env.TW_MAIL_FROM?.trim();
  if (from && env.TW_BREVO_API_KEY) return new BrevoMailer(env.TW_BREVO_API_KEY.trim(), from);
  if (from && env.TW_RESEND_API_KEY) return new ResendMailer(env.TW_RESEND_API_KEY.trim(), from);
  return hosted ? new UnconfiguredMailer() : new ConsoleMailer();
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function resetPasswordMail(to: string, name: string | undefined, link: string, minutes: number): MailMessage {
  const hello = name ? `Hi ${name},` : 'Hi,';
  const text = [
    hello,
    '',
    'Someone (hopefully you) asked to reset the password of your TailWatch account.',
    `Open this link within ${minutes} minutes to choose a new password:`,
    '',
    link,
    '',
    'If you did not ask for this, ignore this e-mail: your password stays the same.',
    '',
    'TailWatch',
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:32px">
<tr><td>
<p style="margin:0 0 4px;font-size:20px;font-weight:700;color:#0f766e">TailWatch</p>
<h1 style="margin:16px 0 8px;font-size:20px">Reset your password</h1>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155">${esc(hello)} someone (hopefully you) asked to reset the password of your TailWatch account. The link works for ${minutes} minutes.</p>
<p style="margin:24px 0"><a href="${esc(link)}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px">Choose a new password</a></p>
<p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#64748b">Or paste this into your browser:<br><span style="word-break:break-all">${esc(link)}</span></p>
<p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#64748b">If you did not ask for this, ignore this e-mail: your password stays the same.</p>
</td></tr></table></td></tr></table></body></html>`;
  return { to, subject: 'Reset your TailWatch password', text, html };
}
