import { REFERRER_SPAM } from './lists/referrer-spam.generated';

/** Matomo's referrer-spam list (public domain), ~2,350 domains (Stage 7). */
const SPAM: ReadonlySet<string> = new Set(REFERRER_SPAM);

/**
 * The listed domain when the referrer's host is that domain or any subdomain of it, else null.
 * `www.` and a trailing dot are ignored. Never throws.
 */
export function referrerSpamDomain(referrer: string | undefined): string | null {
  if (!referrer) return null;
  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
  // Walk up the labels: a.b.spam.com -> b.spam.com -> spam.com (stop before the bare TLD).
  for (let h = host; h.includes('.'); h = h.slice(h.indexOf('.') + 1)) {
    if (SPAM.has(h)) return h;
  }
  return null;
}

export const REFERRER_SPAM_DOMAINS = SPAM.size;
