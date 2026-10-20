import type { ObjectId } from 'mongodb';
import type { SiteConfig } from '@tailwatch/contract';
import { allowedHostsFor } from '../lib/domain';
import { HttpError, errorText, logError } from '../http/errors';
import { kvName, kvProblem } from './kv';
import type { SiteConfigSink } from './kv';
import type { ApiConfig } from '../config';
import type { Setup } from '../models/setup.model';

export type { Setup } from '../models/setup.model';

/**
 * Repository of a site being set up (decision 25): NOTHING is stored in MongoDB or ClickHouse until every
 * install check passed. Until then the setup lives only in Cloudflare KV, in two entries that delete themselves after
 * SETUP_TTL_DAYS:
 *
 *   setup:<workspace id>   the domain, timezone and key being set up (one setup at a time per workspace)
 *   site:<key>             what the collector reads; `setup: true`, so it queues nothing for this key
 *
 * A wrong or abandoned domain therefore leaves nothing behind: the entries simply expire.
 */
export const SETUP_TTL_DAYS = 7;
const SETUP_TTL_SECONDS = SETUP_TTL_DAYS * 86_400;

const setupName = (tenantId: ObjectId) => `setup:${tenantId.toHexString()}`;

function parse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** The collector's entry for a key being set up: accepted from the site's hosts, but never stored. */
export function setupSiteConfig(setup: Setup, region: ApiConfig['region']): SiteConfig {
  return { id: 0, publicKey: setup.publicKey, allowedHosts: allowedHostsFor(setup.domain), live: true, region, setup: true };
}

export function createSetupStore(kv: SiteConfigSink, config: ApiConfig) {
  const read = async (name: string): Promise<string | null> => {
    if (!kv.get) throw new HttpError(503, 'setup_unavailable', 'Site setup needs Cloudflare KV reads; it is not configured on the server.');
    try {
      return await kv.get(name);
    } catch (error) {
      logError('setup_read_failed', { message: errorText(error) });
      throw new HttpError(503, 'setup_unavailable', `${kvProblem(error)}`);
    }
  };
  const write = async (name: string, value: string) => {
    try {
      await kv.put(name, value, { ttlSeconds: SETUP_TTL_SECONDS });
    } catch (error) {
      logError('setup_write_failed', { message: errorText(error) });
      throw new HttpError(503, 'activation_failed', `${kvProblem(error)} Nothing was saved.`);
    }
  };
  /** Best effort: the entries expire by themselves anyway. */
  const forget = async (names: string[]) => {
    await Promise.allSettled(names.map((n) => kv.delete(n)));
  };

  return {
    /** The workspace's setup in progress, or null. */
    async get(tenantId: ObjectId): Promise<Setup | null> {
      return parse<Setup>(await read(setupName(tenantId)));
    },

    /** Starts (or replaces) the workspace's setup: the collector entry first, so the snippet works at once. */
    async start(tenantId: ObjectId, setup: Setup): Promise<void> {
      await write(kvName(setup.publicKey), JSON.stringify(setupSiteConfig(setup, config.region)));
      await write(setupName(tenantId), JSON.stringify(setup));
    },

    /** Keeps the same key (the snippet stays valid), with a new timezone. */
    async update(tenantId: ObjectId, setup: Setup): Promise<void> {
      await write(setupName(tenantId), JSON.stringify(setup));
    },

    /** Cancelled or replaced: the key stops working and nothing is left. */
    async cancel(tenantId: ObjectId, setup: Setup): Promise<void> {
      await forget([setupName(tenantId), kvName(setup.publicKey)]);
    },

    /** Verified: the site now lives in MongoDB and its key entry was rewritten, so only the setup entry goes. */
    async finish(tenantId: ObjectId): Promise<void> {
      await forget([setupName(tenantId)]);
    },
  };
}
export type SetupStore = ReturnType<typeof createSetupStore>;
