import { useCallback, useState } from 'react';
import { account, api } from '../api/client';
import type { Erasure, Site } from '../api/client';
import { useAction } from './useAction';
import { useNotice } from './useNotice';

/** 30 -> "30 days", 180 -> "6 months", 395 -> "13 months". */
export const retentionLabel = (days: number) => (days === 395 ? '13 months' : days === 180 ? '6 months' : days === 365 ? '12 months' : `${days} days`);

/**
 * Retention per site. Lengthening saves at once; shortening deletes data, so it waits for a confirmation
 * (`pending`) first.
 */
export function useRetention(onSaved: (site: Site) => void) {
  const [busySite, setBusySite] = useState<number | null>(null);
  const [pending, setPending] = useState<{ site: Site; days: number } | null>(null);
  const { notice, show } = useNotice();

  const save = useCallback(
    async (site: Site, days: number) => {
      setBusySite(site.id);
      try {
        const { site: updated } = await api.updateSite(site.id, { retentionDays: days });
        onSaved(updated);
        show(
          'success',
          days < site.retentionDays
            ? `${site.domain} now keeps ${retentionLabel(days)}. Older data is deleted within a week.`
            : `${site.domain} now keeps ${retentionLabel(days)}.`,
        );
        setPending(null);
      } catch (e) {
        show('error', e instanceof Error ? e.message : 'Could not save.');
        setPending(null);
      } finally {
        setBusySite(null);
      }
    },
    [onSaved, show],
  );

  const choose = useCallback(
    (site: Site, days: number) => {
      if (days === site.retentionDays) return;
      if (days < site.retentionDays) setPending({ site, days });
      else save(site, days);
    },
    [save],
  );

  return { choose, pending, confirm: () => pending && save(pending.site, pending.days), cancel: () => setPending(null), busySite, notice };
}

/** "Download all data": fetches the export first, so an error is shown instead of being saved as the file. */
export function useAccountExport() {
  const [done, setDone] = useState(false);
  const { run, busy, error } = useAction(async () => {
    setDone(false);
    await account.download();
    setDone(true);
  }, 'The download failed.');
  return { download: run, busy, done, error };
}

/** "Delete account": password + the word DELETE; resolves with what happens next (the erasure). */
export function useDeleteAccount(onDeleted: (erasure: Erasure) => void) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const ready = password.length > 0 && confirm === 'DELETE';
  const { run, busy, error, setError } = useAction(async () => {
    const { erasure } = await account.remove(password, confirm);
    onDeleted(erasure);
  }, 'The account could not be deleted.');

  const reset = () => {
    setPassword('');
    setConfirm('');
    setError(null);
  };

  return { password, setPassword, confirm, setConfirm, ready, submit: run, busy, error, reset };
}
