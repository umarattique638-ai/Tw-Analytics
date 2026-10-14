import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import Button from '../ui/Button';
import ConfirmDialog from '../ui/ConfirmDialog';
import Notice from '../ui/Notice';
import { api } from '../../api/client';
import type { Site } from '../../api/client';
import { useAction } from '../../hooks/useAction';
import { useSession } from '../../hooks/useSession';
import { notify } from '../../lib/notify';

/**
 * A site that is not verified is not on the dashboard yet (decision 24). This removes it, for a customer
 * who typed the wrong domain or gives up: back to the first verified site, or to "Add your site".
 */
export default function CancelSetup({ site }: { site: Site }) {
  const navigate = useNavigate();
  const { reload, select } = useSession();
  const [asking, setAsking] = useState(false);
  const { run, busy, error } = useAction(async () => {
    await api.deleteSite(site.id);
    notify.success(`${site.domain} removed`);
    const remaining = await reload().catch(() => []);
    const next = remaining.find((s) => s.verifiedAt);
    if (next) {
      select(next.id);
      navigate('/dashboard');
    } else navigate('/sites/new');
  }, 'The site could not be removed.');

  return (
    <>
      <Button variant="ghost" className="text-slate-500 hover:text-rose-600 dark:hover:text-rose-300" onClick={() => setAsking(true)}>
        <Trash2 className="size-4" aria-hidden="true" /> Remove this site
      </Button>
      {asking && (
        <ConfirmDialog
          title={`Remove ${site.domain}?`}
          confirmLabel="Remove site"
          busyLabel="Removing…"
          busy={busy}
          onCancel={() => setAsking(false)}
          onConfirm={() => run()}
          message={
            <>
              <p>The site is not verified yet, so it was never on your dashboard. Removing it stops its key; you can add the domain again any time.</p>
              {error && (
                <Notice tone="error" className="mt-3">
                  {error}
                </Notice>
              )}
            </>
          }
        />
      )}
    </>
  );
}
