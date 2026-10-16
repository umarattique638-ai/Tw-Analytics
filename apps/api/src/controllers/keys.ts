import { MAX_ACTIVE_KEYS } from '../lib/constants';
import { HttpError } from '../http/errors';
import type { Api } from '../http/types';
import { newKeyId, newPublicKey } from '../lib/secrets';
import type { Services } from '../services';
import type { KeyDoc, SiteDoc } from '../models/types';
import { shortKey, siteView } from '../views/json';

/** Site keys: rotation is "add a new key, swap the snippet, revoke the old one". */
export function keyController(app: Api, { sites, kvSync, audit, now }: Services) {
  app.post('/sites/:id/keys', async (c) => {
    // Rotation, step 1: add a new active key. Both keys work until the old one is revoked (step 2),
    // so nothing is lost while the customer swaps the snippet.
    const site = await sites.load(c);
    if (site.keys.filter((k) => k.status === 'active').length >= MAX_ACTIVE_KEYS) {
      throw new HttpError(409, 'too_many_keys', 'Revoke an old key before adding another.');
    }
    const fresh: KeyDoc = { id: newKeyId(), publicKey: newPublicKey(), createdAt: now(), revokedAt: null, status: 'active' };
    // Grant: the new key is written to KV first, so it is never shown (or put in a snippet) before it works.
    await kvSync.activateFirst({ ...site, keys: [...site.keys, fresh] }, [fresh.publicKey]);
    let updated: SiteDoc;
    try {
      updated = await sites.patch(c, site, { keys: [...site.keys, fresh] });
    } catch (error) {
      await kvSync.rollbackGrant(site, [fresh.publicKey]);
      throw error;
    }
    await audit.record(c, 'key.created', updated, `Added key ${shortKey(fresh.publicKey)} to ${site.domain}`);
    return c.json({ site: siteView(updated), sync: { ok: true } }, 201);
  });

  app.post('/sites/:id/keys/:keyId/revoke', async (c) => {
    const site = await sites.load(c);
    const keyId = c.req.param('keyId');
    const target = site.keys.find((k) => k.id === keyId);
    if (!target) throw new HttpError(404, 'not_found', 'No such key.');
    if (target.status === 'active' && site.keys.filter((k) => k.status === 'active').length === 1) {
      throw new HttpError(409, 'last_key', 'This is the only active key. Add a new key first, update your snippet, then revoke this one.');
    }
    const at = now();
    const updated = await sites.patch(c, site, {
      keys: site.keys.map((k) => (k.id === keyId ? { ...k, status: 'revoked' as const, revokedAt: k.revokedAt ?? at } : k)),
    });
    const synced = await kvSync.sync(updated);
    if (target.status === 'active') await audit.record(c, 'key.revoked', updated, `Revoked key ${shortKey(target.publicKey)} of ${site.domain}`);
    return c.json({ site: siteView(updated), sync: synced });
  });
}
