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
