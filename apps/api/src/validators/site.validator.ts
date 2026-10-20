import { HttpError } from '../http/errors';
import { str } from '../http/request';
import { canonicalTimezone, normalizeDomain } from '../lib/domain';

/** Request checks of sites, their setup, domains and hosts. Each throws the error the client sees. */

export const invalidDomain = () => new HttpError(400, 'invalid_domain', 'Enter a domain like example.com (no IP addresses or localhost).');
export const invalidTimezone = () => new HttpError(400, 'invalid_timezone', 'Choose a timezone from the list.');

/** `:id` of the URL; anything that is not a site id is simply "no such site" (never "forbidden"). */
export function siteIdParam(raw: string | undefined): number {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(404, 'not_found', 'No such site.');
  return id;
}

/** A domain as people type it ("https://www.Shop.com/") -> "shop.com". */
export function domainInput(raw: unknown): string {
  const domain = normalizeDomain(str(raw));
  if (!domain) throw invalidDomain();
  return domain;
}

/** An IANA timezone, in its canonical spelling. */
export function timezoneInput(raw: unknown): string {
  const tz = canonicalTimezone(str(raw));
  if (!tz) throw invalidTimezone();
  return tz;
}

/** Adding a site: the domain, then the timezone. */
export function setupInput(b: Record<string, unknown>): { domain: string; timezone: string } {
  const domain = domainInput(b.domain);
  const timezone = timezoneInput(b.timezone);
  return { domain, timezone };
}

export interface SitePatchInput {
  timezone?: string;
  status?: 'active' | 'paused';
  /** Checked by the service: it needs the owner or an admin role first. */
  retentionDays?: unknown;
}

/** PATCH /sites/:id: the timezone, then the status. Retention is passed on as sent (role first, then the value). */
export function sitePatchInput(b: Record<string, unknown>): SitePatchInput {
  const input: SitePatchInput = {};
  if (b.timezone !== undefined) input.timezone = timezoneInput(b.timezone);
  if (b.status !== undefined) {
    if (b.status !== 'active' && b.status !== 'paused') throw new HttpError(400, 'invalid_status', 'Status is active or paused.');
    input.status = b.status;
  }
  if (b.retentionDays !== undefined) input.retentionDays = b.retentionDays;
  return input;
}

/** A host name for the accepted hosts ("Shop.Example.com." -> "shop.example.com"; "*.example.com" allowed). */
export function hostInput(raw: unknown): string {
  const host = str(raw).trim().toLowerCase().replace(/\.$/, '');
  if (!/^(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host) || host.length > 253) {
    throw new HttpError(400, 'invalid_host', 'Enter a host name like shop.example.com.');
  }
  return host;
}
