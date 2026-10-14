import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import Button from '../ui/Button';
import ConfirmDialog from '../ui/ConfirmDialog';
import Notice from '../ui/Notice';
import { api } from '../../api/client';
import { useAction } from '../../hooks/useAction';
import { useSession } from '../../hooks/useSession';
import { notify } from '../../lib/notify';

/**
 * Stops the setup in progress (a typo, or the customer gives up). Nothing was saved for it (decision 25), so
 * there is nothing to delete: its key simply stops working. Back to the dashboard, or to "Add your site".
 */
export default function CancelSetup({ domain }: { domain: string }) {
  const navigate = useNavigate();
  const { setSetup, sites } = useSession();
  const [asking, setAsking] = useState(false);
  const { run, busy, error } = useAction(async () => {
    await api.cancelSetup();
    setSetup(null);
    notify.success(`Setup of ${domain} cancelled`);
    navigate(sites.length ? '/dashboard' : '/sites/new');
  }, 'The setup could not be cancelled.');

  return (
    <>
      <Button variant="ghost" className="text-slate-500 hover:text-rose-600 dark:hover:text-rose-300" onClick={() => setAsking(true)}>
        <Trash2 className="size-4" aria-hidden="true" /> Cancel setup
      </Button>
      {asking && (
        <ConfirmDialog
          title={`Cancel setting up ${domain}?`}
          confirmLabel="Cancel setup"
          busyLabel="Cancelling…"
          busy={busy}
          onCancel={() => setAsking(false)}
          onConfirm={() => run()}
          message={
            <>
              <p>Nothing was saved for {domain}: it is saved only once every check passes. Cancelling stops its script key; remove the script from your site too.</p>
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
