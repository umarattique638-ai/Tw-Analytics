import { useEffect } from 'react';
import { CloudOff, RotateCw } from 'lucide-react';
import Button from '../ui/Button';
import { useSession } from '../../hooks/useSession';
import { useAction } from '../../hooks/useAction';
import { notify } from '../../lib/notify';

/**
 * Shown while a change has not reached Cloudflare KV yet (decision 18): the collector may still accept a
 * revoked key, or a paused/deleted site may still collect. The server retries by itself; this says so,
 * names the sites, and gives the one-line reason (usually the Cloudflare API token).
 */
export default function SyncBanner() {
  const { kvIssues, retrySync, reload } = useSession();
  const { run: retry, busy } = useAction(async () => {
    try {
      await retrySync();
    } catch (e) {
      notify.error(e, 'Retry failed.');
    }
  });

  // While something is pending, look again every minute (the server retries on these calls).
  useEffect(() => {
    if (!kvIssues.length) return;
    const t = setInterval(() => reload().catch(() => undefined), 60_000);
    return () => clearInterval(t);
  }, [kvIssues.length, reload]);

  if (!kvIssues.length) return null;

  const names = kvIssues.map((i) => `${i.domain}${i.deleted ? ' (deleted)' : ''}`).join(', ');
  return (
    <div
      role="alert"
      data-testid="sync-banner"
      className="mb-6 flex flex-wrap items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100"
    >
      <CloudOff className="mt-0.5 size-5 flex-none" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Some changes have not reached the collector yet: {names}</p>
        <p className="mt-0.5 opacity-90">{kvIssues[0]!.error}</p>
        <p className="mt-0.5 text-xs opacity-75">Your changes are saved. We retry by ourselves; until then a revoked key or a paused site may still collect.</p>
      </div>
      <Button variant="secondary" size="sm" onClick={() => retry()} disabled={busy}>
        <RotateCw className={`size-4 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" /> Retry now
      </Button>
    </div>
  );
}
