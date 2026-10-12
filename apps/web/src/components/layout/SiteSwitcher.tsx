import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronsUpDown, Globe, Plus, Trash2 } from 'lucide-react';
import ConfirmDialog from '../ui/ConfirmDialog';
import Notice from '../ui/Notice';
import { useSession } from '../../hooks/useSession';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { useDeleteSite } from '../../hooks/useSiteActions';
import type { Site } from '../../api/client';

const dot = (s: Site) => (s.status === 'paused' ? 'bg-amber-400' : s.verifiedAt ? 'bg-emerald-400' : 'bg-slate-500');
const dotLabel = (s: Site) => (s.status === 'paused' ? 'Paused' : s.verifiedAt ? 'Collecting' : 'Not installed yet');

/** The site being looked at, in the sidebar: switch to another site, add one, or delete one. */
export default function SiteSwitcher() {
  const navigate = useNavigate();
  const { sites, current, select, reload } = useSession();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(box, close, open);
  useEscapeKey(close, open);

  const del = useDeleteSite({ reload, currentId: current?.id ?? null, select, onNoneLeft: () => navigate('/sites/new') });

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-400/25 ${
          open ? 'border-teal-400/40 bg-white/10' : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08]'
        }`}
      >
        <span className="grid size-8 flex-none place-items-center rounded-lg bg-teal-400/15 text-teal-300">
          <Globe className="size-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] text-slate-400">Site</span>
          <span className="block truncate text-sm font-medium text-white">{current?.domain ?? 'No site yet'}</span>
        </span>
        <ChevronsUpDown className="size-4 flex-none text-slate-500" aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute inset-x-0 top-full z-20 mt-1.5 origin-top animate-[tw-pop_120ms_ease-out] overflow-hidden rounded-xl border border-white/10 bg-slate-900 shadow-2xl shadow-black/40">
          <p className="px-3 pt-2.5 pb-1 text-xs font-medium text-slate-500">Your sites</p>
          <ul className="max-h-64 overflow-y-auto pb-1">
            {sites.length === 0 && <li className="px-3 py-2 text-xs text-slate-500">No sites yet</li>}
            {sites.map((s) => {
              const on = s.id === current?.id;
              return (
                <li key={s.id} className="group flex items-center gap-1 px-1.5">
                  <button
                    type="button"
                    aria-current={on || undefined}
                    onClick={() => {
                      select(s.id);
                      close();
                    }}
                    className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm transition hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none ${on ? 'text-white' : 'text-slate-300'}`}
                  >
                    <span className={`size-2 flex-none rounded-full ${dot(s)}`} title={dotLabel(s)} />
                    <span className="truncate">{s.domain}</span>
                    {on && <Check className="ml-auto size-3.5 flex-none text-teal-300" aria-label="Selected" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      del.ask(s);
                    }}
                    title={`Delete ${s.domain}`}
                    aria-label={`Delete ${s.domain}`}
                    className="grid size-8 flex-none place-items-center rounded-lg text-slate-500 opacity-60 transition group-hover:opacity-100 hover:bg-rose-500/15 hover:text-rose-300 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/40"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={() => {
              close();
              navigate('/sites/new');
            }}
            className="flex w-full items-center gap-2 border-t border-white/10 px-4 py-2.5 text-left text-sm font-medium text-teal-300 transition hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none"
          >
            <Plus className="size-4" aria-hidden="true" /> Add a site
          </button>
        </div>
      )}

      {del.target && (
        <ConfirmDialog
          title={`Delete ${del.target.domain}?`}
          confirmLabel="Delete site"
          busyLabel="Deleting…"
          busy={del.busy}
          onCancel={del.cancel}
          onConfirm={del.confirm}
          message={
            <>
              <p>
                The site stops collecting and is removed from your account. Data already collected is kept for the site's retention ({del.target.retentionDays} days), so
                adding the domain again brings it back.
              </p>
              {del.error && (
                <Notice tone="error" className="mt-3">
                  {del.error}
                </Notice>
              )}
            </>
          }
        />
      )}
    </div>
  );
}
