import { useState } from 'react';
import { Code2, Moon, RefreshCw } from 'lucide-react';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import Notice from '../ui/Notice';
import Skeleton from '../ui/Skeleton';
import CodeBlock from '../onboarding/CodeBlock';
import { muted } from '../ui/styles';
import { useSiteHealth } from '../../hooks/useSiteHealth';
import { useSnippets } from '../../hooks/useSetup';
import type { Site } from '../../api/client';

/** "8 hours", "3 days" without data (since the last event, or since the site was added if none came). */
function silence(hours: number | null): string {
  if (hours === null) return 'a while';
  const h = Math.max(1, hours);
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'}`;
  return `${Math.round(h / 24)} days`;
}

/**
 * Decision 28, at the top of the dashboard:
 *   broken  red: nothing arrives AND the install check fails here; how to fix it, and "Check again"
 *   quiet   a calm line: installed correctly, there were simply no visitors
 *   healthy, paused, not checked yet: nothing
 */
export default function HealthBanner({ site }: { site: Site }) {
  const { health, checking, checkAgain } = useSiteHealth(site);
  const [scriptOpen, setScriptOpen] = useState(false);
  if (!health) return null;

  if (health.status === 'quiet') {
    return (
      <div role="status" data-testid="health-quiet" className={`flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm dark:border-slate-800 dark:bg-slate-900 ${muted}`}>
        <Moon className="size-4 flex-none text-slate-400" aria-hidden="true" />
        <span>
          The script is installed correctly. No visitors in the last {silence(health.silentForHours)}.
        </span>
      </div>
    );
  }
  if (health.status !== 'broken') return null;

  return (
    <>
      <Notice tone="error" className="py-4">
        <div data-testid="health-broken">
          <p className="font-semibold">{site.domain} has stopped sending data</p>
          <p className="mt-1 leading-relaxed">
            Nothing has arrived for {silence(health.silentForHours)}, so visits are not being counted. We opened your site and found a problem:
          </p>
          {health.reason && <p className="mt-2 rounded-lg bg-white/70 px-3 py-2 font-medium dark:bg-black/20">{health.reason}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" className="h-9" onClick={checkAgain} loading={checking}>
              {!checking && <RefreshCw className="size-4" aria-hidden="true" />} Check again
            </Button>
            <Button variant="secondary" size="sm" className="h-9" onClick={() => setScriptOpen(true)}>
              <Code2 className="size-4" aria-hidden="true" /> Get the script
            </Button>
            <span className="text-[13px] opacity-80">We e-mail you once when this starts, and once when data arrives again.</span>
          </div>
        </div>
      </Notice>
      {scriptOpen && <ScriptDialog site={site} onClose={() => setScriptOpen(false)} />}
    </>
  );
}

function ScriptDialog({ site, onClose }: { site: Site; onClose: () => void }) {
  const { tag, loading, error } = useSnippets(site);
  return (
    <Modal
      wide
      title={`The script for ${site.domain}`}
      onClose={onClose}
      footer={
        <Button variant="secondary" size="sm" className="h-10 px-4" onClick={onClose} data-autofocus>
          Close
        </Button>
      }
    >
      <p>
        Paste this one line inside the <code className="rounded bg-slate-100 px-1 py-0.5 text-[13px] dark:bg-slate-800">&lt;head&gt;</code> of every page, publish your site, then press Check again.
      </p>
      <div className="mt-4">
        {error && <Notice tone="error">{error}</Notice>}
        {loading && <Skeleton className="h-24 w-full rounded-xl" />}
        {tag && <CodeBlock code={tag.code} copyLabel="Copy script" copyTestId="copy-script" />}
      </div>
    </Modal>
  );
}
