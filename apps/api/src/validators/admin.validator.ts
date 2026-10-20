import { ObjectId } from 'mongodb';
import { HttpError } from '../http/errors';
import { str } from '../http/request';
import { DELETE_CONFIRMATION } from '../lib/constants';

/** Request checks of the super admin pages (/admin). Each throws the error the client sees. */

/** `:tenantId` of the URL; anything that is not an id is simply "no such account". */
export function tenantIdParam(raw: string | undefined): ObjectId {
  const id = raw ?? '';
  if (!/^[0-9a-f]{24}$/.test(id)) throw new HttpError(404, 'not_found', 'No such account.');
  return new ObjectId(id);
}

/** Deleting someone's account: the typed confirmation, as in Settings. */
export function confirmInput(b: Record<string, unknown>): void {
  if (str(b.confirm) !== DELETE_CONFIRMATION) throw new HttpError(400, 'confirm_required', `Type ${DELETE_CONFIRMATION} to confirm.`);
}

/** The accounts search box: at most 100 characters. */
export const accountsQueryInput = (raw: string | undefined) => (raw ?? '').trim().slice(0, 100);
