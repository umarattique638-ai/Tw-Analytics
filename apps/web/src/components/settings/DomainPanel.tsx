import { useState } from 'react';
import { Globe } from 'lucide-react';
import Button from '../ui/Button';
import Panel from '../ui/Panel';
import ChangeDomainDialog from './ChangeDomainDialog';
import type { Site } from '../../api/client';

/** Decision 29: each site's domain, and "Change domain" for a site that moved. */
export default function DomainPanel({ sites, canEdit, onSaved }: { sites: Site[]; canEdit: boolean; onSaved: (s: Site) => void }) {
  const [editing, setEditing] = useState<Site | null>(null);
  return (
    <Panel title="Site domains" subtitle="Moved a site to a new address? Change its domain here and keep its history.">
      {sites.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Add a site first.</p>
      ) : (
        <ul className="grid gap-3" data-testid="domain-list">
          {sites.map((site) => (
            <li key={site.id} className="flex min-w-0 flex-col gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center dark:border-slate-800">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="grid size-9 flex-none place-items-center rounded-lg bg-teal-50 text-teal-700 dark:bg-teal-400/10 dark:text-teal-300">
                  <Globe className="size-[18px]" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900 dark:text-white">{site.domain}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Counts visits on {site.domain} and its subdomains</p>
                </div>
              </div>
              <Button variant="secondary" size="sm" className="h-9" onClick={() => setEditing(site)} disabled={!canEdit || site.status !== 'active'}>
                Change domain
              </Button>
            </li>
          ))}
        </ul>
      )}
      {!canEdit && <p className="mt-4 text-[13px] text-slate-500 dark:text-slate-400">Only the owner or an admin can change a domain.</p>}
      {editing && <ChangeDomainDialog site={editing} onClose={() => setEditing(null)} onChanged={onSaved} />}
    </Panel>
  );
}
