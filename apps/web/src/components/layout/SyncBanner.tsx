import { useEffect, useState } from 'react';
import { CloudOff, RotateCw } from 'lucide-react';
import { useSession } from '../../api/session';

/**
 * Shown while a change has not reached Cloudflare KV yet (decision 18): the collector may still accept a
 * revoked key, or a paused/deleted site may still collect. The server retries by itself; this says so,
 * names the sites, and gives the one-line reason (usually the Cloudflare API token).
 */
export default function SyncBanner() {
  const { kvIssues, retrySync, reload } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // While something is pending, look again every minute (the server retries on these calls).
  useEffect(() => {
    if (!kvIssues.length) return;
    const t = setInterval(() => reload().catch(() => undefined), 60_000);
    return () => clearInterval(t);
  }, [kvIssues.length, reload]);

  if (!kvIssues.length) return null;

  const retry = async () => {
    setBusy(true);
    setError(null);
    try {
      await retrySync();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Retry failed.');
    } finally {
      setBusy(false);
    }
  };

  const names = kvIssues.map((i) => `${i.domain}${i.deleted ? ' (deleted)' : ''}`).join(', ');
  return (
    <div
      role="alert"
      data-testid="sync-banner"
      className="mb-6 flex flex-wrap items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100"
    >
      <CloudOff className="mt-0.5 size-5 flex-none" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Some changes have not reached the collector yet: {names}</p>
        <p className="mt-0.5 opacity-90">{kvIssues[0]!.error}</p>
        <p className="mt-0.5 text-xs opacity-75">Your changes are saved. We retry by ourselves; until then a revoked key or a paused site may still collect.</p>
        {error && <p className="mt-1 text-xs font-medium text-red-700 dark:text-red-300">{error}</p>}
      </div>
      <button
        type="button"
        onClick={retry}
        disabled={busy}
        className="inline-flex h-9 flex-none items-center gap-2 rounded-lg border border-amber-400 bg-white px-3 font-semibold text-amber-900 transition hover:bg-amber-100 disabled:opacity-60 dark:border-amber-400/40 dark:bg-transparent dark:text-amber-100 dark:hover:bg-amber-400/10"
      >
        <RotateCw className={`size-4 ${busy ? 'animate-spin' : ''}`} /> Retry now
      </button>
    </div>
  );
}
