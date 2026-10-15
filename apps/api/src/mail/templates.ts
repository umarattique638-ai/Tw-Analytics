import type { MailMessage } from './providers';

/** The e-mails TailWatch sends, as plain text and simple HTML (every user value is escaped). */
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

/** Sent at sign-up (and again on request): the account can log in once this link is opened. */
export function verifyEmailMail(to: string, name: string | undefined, link: string, hours: number): MailMessage {
  const hello = name ? `Hi ${name},` : 'Hi,';
  const text = [
    hello,
    '',
    'Welcome to TailWatch. Confirm that this is your e-mail address to finish creating your account:',
    '',
    link,
    '',
    `The link works for ${hours} hours. If you did not sign up, ignore this e-mail: no account is opened without it.`,
    '',
    'TailWatch',
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:32px">
<tr><td>
<p style="margin:0 0 4px;font-size:20px;font-weight:700;color:#0f766e">TailWatch</p>
<h1 style="margin:16px 0 8px;font-size:20px">Confirm your e-mail</h1>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155">${esc(hello)} welcome to TailWatch. Confirm that this is your address to finish creating your account. The link works for ${hours} hours.</p>
<p style="margin:24px 0"><a href="${esc(link)}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px">Confirm my e-mail</a></p>
<p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#64748b">Or paste this into your browser:<br><span style="word-break:break-all">${esc(link)}</span></p>
<p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#64748b">If you did not sign up, ignore this e-mail: no account is opened without it.</p>
</td></tr></table></td></tr></table></body></html>`;
  return { to, subject: 'Confirm your e-mail for TailWatch', text, html };
}

/** The same simple card as the reset e-mail, with plain paragraphs. */
function card(title: string, paragraphs: string[]): string {
  return `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:32px">
<tr><td>
<p style="margin:0 0 4px;font-size:20px;font-weight:700;color:#0f766e">TailWatch</p>
<h1 style="margin:16px 0 8px;font-size:20px">${esc(title)}</h1>
${paragraphs.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#334155">${esc(p)}</p>`).join('\n')}
</td></tr></table></td></tr></table></body></html>`;
}

/** Sent when an account is deleted: what is gone now, and what is still being erased. */
export function accountDeletedMail(to: string, name: string | null, sites: number, settleDays: number): MailMessage {
  const hello = name ? `Hi ${name},` : 'Hi,';
  const lines = [
    `${hello} your TailWatch account was deleted just now.`,
    `Your login, workspace, ${sites === 1 ? 'site' : `${sites} sites`}, saved reports and activity log are gone. Tracking stopped: the collector no longer accepts your site keys.`,
    `The analytics your sites collected are being erased in the background. This finishes within ${settleDays + 1} days, and we send one more e-mail when it is done.`,
    'If you did not do this, reply to this e-mail at once.',
  ];
  return { to, subject: 'Your TailWatch account was deleted', text: [...lines, '', 'TailWatch'].join('\n\n'), html: card('Your account was deleted', lines) };
}

/** Sent when every row of the account's sites is gone (verified by a count). Last e-mail we send. */
export function erasureDoneMail(to: string, name: string | null, rows: number, watchDays: number): MailMessage {
  const hello = name ? `Hi ${name},` : 'Hi,';
  const lines = [
    `${hello} the erasure of your TailWatch data is complete.`,
    `We deleted the analytics of your sites (${rows.toLocaleString('en-US')} stored rows when you deleted the account) and checked that nothing is left in our database.`,
    `For the next ${watchDays} days we keep checking, in case a delayed event still arrives, and delete it too. Raw backup copies of incoming events expire on their own within 30 days.`,
    'We have deleted your e-mail address as well: this is the last message you get from us.',
  ];
  return { to, subject: 'Your TailWatch data has been erased', text: [...lines, '', 'TailWatch'].join('\n\n'), html: card('Your data has been erased', lines) };
}

/** A card with one button (site-health e-mails). */
function cardWithButton(title: string, paragraphs: string[], button: { label: string; link: string }, after: string[] = []): string {
  const p = (t: string) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#334155">${esc(t)}</p>`;
  return `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:32px">
<tr><td>
<p style="margin:0 0 4px;font-size:20px;font-weight:700;color:#0f766e">TailWatch</p>
<h1 style="margin:16px 0 8px;font-size:20px">${esc(title)}</h1>
${paragraphs.map(p).join('\n')}
<p style="margin:22px 0"><a href="${esc(button.link)}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px">${esc(button.label)}</a></p>
${after.map((t) => `<p style="margin:0 0 10px;font-size:13px;line-height:1.6;color:#64748b">${esc(t)}</p>`).join('\n')}
</td></tr></table></td></tr></table></body></html>`;
}

/** Decision 28: a site went silent and its install check fails. Sent once per outage. */
export function siteBrokenMail(to: string, name: string | null, domain: string, silence: string, reason: string, link: string): MailMessage {
  const hello = name ? `Hi ${name},` : 'Hi,';
  const lines = [
    `${hello} TailWatch has received no data from ${domain} for ${silence}.`,
    `We looked into why. What we found: ${reason}`,
    'Until this is fixed, visits to the site are not counted. Open the dashboard to see the details, copy the script again and run the check.',
  ];
  const after = ['We send this once. When data arrives again, you get one short e-mail saying so.'];
  return {
    to,
    subject: `${domain} stopped sending data to TailWatch`,
    text: [...lines, '', link, '', ...after, '', 'TailWatch'].join('\n\n'),
    html: cardWithButton(`${domain} stopped sending data`, lines, { label: 'Open the dashboard', link }, after),
  };
}

/** Decision 31: far more traffic than usual in the last 24 hours, and where it came from. */
export function siteSpikeMail(
  to: string,
  name: string | null,
  domain: string,
  spike: { pageviews: number; usual: number; times: number },
  details: { pages: { label: string; count: number }[]; countries: { label: string; count: number }[]; referrers: { label: string; count: number }[]; blocked: number },
  link: string,
): MailMessage {
  const hello = name ? `Hi ${name},` : 'Hi,';
  const n = (v: number) => Math.round(v).toLocaleString('en-US');
  const list = (rows: { label: string; count: number }[], empty: string) => (rows.length ? rows.map((r) => `${r.label || empty} (${n(r.count)})`).join(', ') : '-');
  const usual =
    spike.usual >= 1 ? `about ${spike.times >= 10 ? Math.round(spike.times) : spike.times.toFixed(1)} times its usual ${n(spike.usual)} a day` : 'while it usually gets almost none';
  const lines = [
    `${hello} ${domain} had ${n(spike.pageviews)} page views in the last 24 hours, ${usual}.`,
    `Top pages: ${list(details.pages, '/')}.`,
    `Top countries: ${list(details.countries, 'unknown')}.`,
    `Top referrers: ${list(details.referrers, 'direct')}.`,
    details.blocked > 0
      ? `In the same 24 hours we blocked ${n(details.blocked)} hits (bots, other websites using your key). Those are not in the numbers above.`
      : 'We blocked no hits in the same 24 hours, so this looks like real visitors.',
  ];
  return {
    to,
    subject: `Unusual traffic on ${domain}: ${n(spike.pageviews)} page views in 24 hours`,
    text: [...lines, '', link, '', 'At most one such e-mail a day.', '', 'TailWatch'].join('\n\n'),
    html: cardWithButton(`Unusual traffic on ${domain}`, lines, { label: 'Open the dashboard', link }, ['At most one such e-mail a day.']),
  };
}

/** Decision 28: data arrives again from a site we e-mailed about. */
export function siteRecoveredMail(to: string, name: string | null, domain: string, link: string): MailMessage {
  const hello = name ? `Hi ${name},` : 'Hi,';
  const lines = [`${hello} good news: ${domain} is sending data to TailWatch again, and visits are being counted.`, 'Nothing else to do.'];
  return {
    to,
    subject: `${domain} is sending data again`,
    text: [...lines, '', link, '', 'TailWatch'].join('\n\n'),
    html: cardWithButton(`${domain} is sending data again`, lines, { label: 'Open the dashboard', link }),
  };
}

/** Decision 28: most sites went silent at once. That is our pipeline, not the customers: only the operator hears. */
export function pipelineSilentMail(to: string, silent: number, total: number, domains: string[]): MailMessage {
  const lines = [
    `${silent} of ${total} active sites have sent no data for longer than usual. That many at once points at the TailWatch pipeline (collector, queue, consumer or ClickHouse), not at the sites.`,
    'No customer was e-mailed about it tonight. Check the collector and consumer logs in Cloudflare, and the ClickHouse service.',
    `Silent: ${domains.slice(0, 20).join(', ')}${domains.length > 20 ? `, and ${domains.length - 20} more` : ''}.`,
  ];
  return { to, subject: `TailWatch: ${silent} of ${total} sites are silent`, text: [...lines, '', 'TailWatch health check'].join('\n\n'), html: card('Many sites are silent at once', lines) };
}
