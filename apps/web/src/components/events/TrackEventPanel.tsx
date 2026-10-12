import CodeBlock from '../onboarding/CodeBlock';
import Panel from '../ui/Panel';
import Skeleton from '../ui/Skeleton';
import Notice from '../ui/Notice';
import { muted } from '../ui/styles';
import { useSnippets } from '../../hooks/useSetup';
import type { Site } from '../../api/client';

/** How to send a custom event: the same API-made code as on the install page. */
export default function TrackEventPanel({ site }: { site: Site }) {
  const { events, loading, error } = useSnippets(site);
  return (
    <Panel title="Track a custom event" subtitle="Any event name works right away. No registration needed.">
      {error && <Notice tone="error">{error}</Notice>}
      {loading && <Skeleton className="h-40 w-full rounded-xl" />}
      {events && (
        <>
          <CodeBlock code={events.code} copyLabel="Copy event code" />
          {events.note && <p className={`mt-3 text-[13px] leading-relaxed ${muted}`}>{events.note}</p>}
        </>
      )}
    </Panel>
  );
}
