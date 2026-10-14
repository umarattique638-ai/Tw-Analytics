import { useId, useState } from 'react';
import { Archive, Trash2 } from 'lucide-react';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import Notice from '../ui/Notice';
import { inputCls } from '../ui/styles';
import type { Role, Site } from '../../api/client';

type Props = {
  site: Site;
  role: Role;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (eraseData: boolean) => void;
};

const days = (n: number) => (n % 30 === 0 && n >= 60 ? `${n / 30} months` : n === 395 ? '13 months' : `${n} days`);

/**
 * "Delete this site": keep what was collected (the default, it can come back) or erase it now, for good.
 * Erasing is for owners and admins, and asks for the domain to be typed, so it is never a slip.
 */
export default function DeleteSiteDialog({ site, role, busy, error, onCancel, onConfirm }: Props) {
  const [erase, setErase] = useState(false);
  const [typed, setTyped] = useState('');
  const name = useId();
  const canErase = role === 'owner' || role === 'admin';
  const confirmed = !erase || typed.trim().toLowerCase() === site.domain;

  const option = (value: boolean, title: string, text: string, Icon: typeof Archive, disabled = false) => {
    const on = erase === value;
    const tone = value
      ? on
        ? 'border-rose-400 bg-rose-50/70 ring-4 ring-rose-500/10 dark:border-rose-400/60 dark:bg-rose-400/10'
        : 'border-slate-200 dark:border-slate-700'
      : on
        ? 'border-teal-500 bg-teal-50/60 ring-4 ring-teal-600/10 dark:border-teal-400/60 dark:bg-teal-400/10'
        : 'border-slate-200 dark:border-slate-700';
    return (
      <label
        className={`flex gap-3 rounded-xl border p-3.5 transition ${tone} ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-slate-300 dark:hover:border-slate-600'}`}
        data-option={value ? 'erase' : 'keep'}
      >
        <input
          type="radio"
          name={name}
          className="sr-only"
          checked={on}
          disabled={disabled || busy}
          onChange={() => {
            setErase(value);
            setTyped('');
          }}
        />
        <span
          className={`mt-0.5 grid size-8 flex-none place-items-center rounded-lg ${
            value ? 'bg-rose-100 text-rose-700 dark:bg-rose-400/15 dark:text-rose-300' : 'bg-teal-100 text-teal-800 dark:bg-teal-400/15 dark:text-teal-300'
          }`}
        >
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-slate-900 dark:text-white">{title}</span>
            <span
              className={`grid size-4 flex-none place-items-center rounded-full border-2 ${on ? (value ? 'border-rose-600' : 'border-teal-700 dark:border-teal-400') : 'border-slate-300 dark:border-slate-600'}`}
              aria-hidden="true"
            >
              {on && <span className={`size-1.5 rounded-full ${value ? 'bg-rose-600' : 'bg-teal-700 dark:bg-teal-400'}`} />}
            </span>
          </span>
          <span className="mt-1 block text-[13px] leading-relaxed text-slate-600 dark:text-slate-400">{text}</span>
        </span>
      </label>
    );
  };

  return (
    <Modal
      wide
      title={`Delete ${site.domain}?`}
      onClose={onCancel}
      locked={busy}
      footer={
        <>
          <Button variant="secondary" size="sm" className="h-10 px-4" onClick={onCancel} disabled={busy} data-autofocus>
            Cancel
          </Button>
          <Button variant="danger" size="sm" className="h-10 px-4" onClick={() => onConfirm(erase)} loading={busy} disabled={!confirmed}>
            {busy ? 'Deleting…' : erase ? 'Delete site and data' : 'Delete site'}
          </Button>
        </>
      }
    >
      <p>Tracking stops and the site leaves your dashboard. What happens to the data already collected?</p>
      <fieldset className="mt-4 grid gap-2.5">
        <legend className="sr-only">Collected data</legend>
        {option(
          false,
          'Keep the data',
          `Kept for the site's retention (${days(site.retentionDays)}), then deleted. Add the domain again any time and its history comes back.`,
          Archive,
        )}
        {option(
          true,
          'Delete all data now',
          canErase
            ? 'Every visit, page view, session and event collected for this site is erased, along with its saved reports. This cannot be undone.'
            : 'Only the owner or an admin can erase collected data.',
          Trash2,
          !canErase,
        )}
      </fieldset>

      {erase && (
        <label className="mt-4 grid gap-1.5">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Type <b className="font-mono text-[13px]">{site.domain}</b> to confirm
          </span>
          <input
            className={inputCls}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            spellCheck={false}
            autoCapitalize="none"
            autoComplete="off"
            disabled={busy}
            aria-label={`Type ${site.domain} to confirm`}
          />
        </label>
      )}

      {error && (
        <Notice tone="error" className="mt-3">
          {error}
        </Notice>
      )}
    </Modal>
  );
}
