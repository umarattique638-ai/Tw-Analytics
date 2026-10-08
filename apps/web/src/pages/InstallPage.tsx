import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import Button from '../components/ui/Button';
import FormError from '../components/ui/FormError';
import PageHeader from '../components/ui/PageHeader';
import CodeBlock from '../components/onboarding/CodeBlock';
import { muted } from '../components/ui/styles';
import { api } from '../api/client';
import type { Snippet, Sync } from '../api/client';
import { useSession } from '../api/session';

type Group = Snippet['group'];
const TABS: { id: Group; label: string }[] = [
  { id: 'script-tag', label: 'Script tag' },
  { id: 'npm', label: 'npm package' },
  { id: 'framework', label: 'Framework' },
  { id: 'wordpress', label: 'WordPress' },
];

/** Shows the snippets the API generated for this site's key. Nothing is composed here. */
export default function InstallPage() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const { current } = useSession();
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [group, setGroup] = useState<Group>('script-tag');
  const [pick, setPick] = useState<string>('next');
  const [copied, setCopied] = useState(false);
  const [sync, setSync] = useState<Sync | undefined>((state as { sync?: Sync } | null)?.sync);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!current) return;
    api.site(current.id).then((r) => setSnippets(r.snippets), (e: Error) => setError(e.message));
  }, [current]);

  if (!current) return <Navigate to="/sites/new" replace />;

  const inGroup = snippets.filter((s) => s.group === group);
  const shown = (group === 'framework' ? inGroup.find((s) => s.id === pick) : undefined) ?? inGroup[0];

  const copy = async () => {
    if (!shown) return;
    try {
      await navigator.clipboard.writeText(shown.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked: the code is selectable */
    }
  };

  const retry = async () => {
    try {
      setSync((await api.sync(current.id)).sync);
    } catch (e) {
      setSync({ ok: false, message: e instanceof Error ? e.message : 'Retry failed.' });
    }
  };

  return (
    <>
      <PageHeader title="Choose how to install" sub={<>For <b>{current.domain}</b>. Not sure? Use the script tag. It works on any site.</>} />

      {sync && !sync.ok && (
        <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
          <span>Your site is saved, but it is not active at the edge yet. {sync.message}</span>
          <Button variant="ghost" type="button" onClick={retry}>Retry activation</Button>
        </div>
      )}

      <div role="tablist" className="mb-4 flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={group === t.id}
            onClick={() => setGroup(t.id)}
            className={`cursor-pointer border-b-[3px] px-3.5 py-2 font-semibold ${
              group === t.id ? 'border-teal-700 dark:border-teal-400' : 'border-transparent text-slate-500 dark:text-slate-400'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {group === 'framework' && (
        <div className="mb-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Framework">
          {inGroup.map((s) => (
            <button
              key={s.id}
              role="radio"
              aria-checked={shown?.id === s.id}
              onClick={() => setPick(s.id)}
              className={`rounded-full border px-3 py-1 text-sm font-medium transition ${
                shown?.id === s.id
                  ? 'border-teal-700 bg-teal-50 text-teal-800 dark:border-teal-400 dark:bg-teal-400/10 dark:text-teal-200'
                  : 'border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      <FormError message={error} />
      {shown ? (
        <>
          {shown.availability === 'soon' && (
            <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-400/10 dark:text-amber-300">
              Coming soon
            </p>
          )}
          <CodeBlock code={shown.code} />
          {shown.note && <p className={`mt-3 text-[13px] leading-relaxed ${muted}`}>{shown.note}</p>}
        </>
      ) : (
        !error && <p className={muted}>Loading…</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="ghost" type="button" onClick={copy} disabled={!shown}>
          {copied ? 'Copied!' : 'Copy'}
        </Button>
        <Button onClick={() => navigate('/verify')}>I added it</Button>
      </div>
    </>
  );
}
