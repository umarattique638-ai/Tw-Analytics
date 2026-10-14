import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { Seen, Setup, Site, VerifyResult } from '../api/client';
import type { Step } from '../components/onboarding/CheckList';

const POLL_MS = 3000;
/** Pause between two steps turning green: quick, but slow enough to follow. */
const STEP_MS = 380;

/** The verifier's steps, in the order the server runs them (apps/api/src/verifier/types.ts CHECK_ORDER). */
export const CHECKS: { id: string; label: string }[] = [
  { id: 'reach', label: 'Site reachable' },
  { id: 'present', label: 'Snippet in page source' },
  { id: 'noscript', label: 'Not in noscript or a comment' },
  { id: 'once', label: 'Only one snippet' },
  { id: 'script', label: 'Script loads' },
  { id: 'csp', label: 'Content-Security-Policy allows it' },
  { id: 'id', label: 'Site key matches' },
];

/** Only http(s) pages can be opened from the result; anything else typed into the field is ignored for the link. */
export const safePageUrl = (u: string) => (/^https?:\/\//i.test(u.trim()) ? u.trim() : null);

/**
 * Step 3, "Verify" (decisions 24, 25). The server opens the page like a visitor and runs 7 checks in the order a
 * browser goes through; the first failing step stops the check. The site is SAVED (verified) only when every
 * step passed AND the collector noted a first pageview; before that nothing is stored anywhere.
 *  - the check starts by itself once, and again on "Check again";
 *  - meanwhile this page asks every 3 s whether the first pageview has arrived; when it does after a passing
 *    check, the check runs once more so the server can save the site.
 */
export function useInstallCheck(setup: Setup | null, onSaved: (site: Site) => void) {
  const [seen, setSeen] = useState<Seen | null>(setup?.seen ?? null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [url, setUrl] = useState(setup ? `https://${setup.domain}/` : '');
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [saved, setSaved] = useState<Site | null>(null);
  const [shown, setShown] = useState(0);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const started = useRef<string | null>(null);
  const rechecked = useRef(false);
  const key = setup?.publicKey;
  const verified = !!saved;
  const onSite = useRef(onSaved);
  onSite.current = onSaved;

  // Another setup started while on this page: start over for it.
  useEffect(() => {
    if (!setup) return;
    setSeen(setup.seen);
    setResult(null);
    setShown(0);
    rechecked.current = false;
    setUrl(`https://${setup.domain}/`);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Waiting for your first pageview": asks until one arrives (or the site is saved).
  useEffect(() => {
    if (!key || verified) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await api.setup();
        if (!live) return;
        setPollError(null);
        if (r.setup?.publicKey === key && r.setup.seen) return setSeen(r.setup.seen); // got it: stop asking
      } catch (e) {
        if (live) setPollError(e instanceof Error ? e.message : 'Could not ask for the first pageview.');
      }
      if (live) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, verified]);

  const run = useCallback(
    async (target: string, reveal = true) => {
      if (!key) return;
      setRunning(true);
      setCheckError(null);
      if (reveal) {
        setResult(null);
        setShown(0);
      }
      try {
        const r = await api.verifySetup(target);
        setResult(r);
        if (r.seen) setSeen(r.seen);
        if (!reveal) setShown(r.checks.length);
        if (r.site) {
          setSaved(r.site);
          onSite.current(r.site);
        }
      } catch (err) {
        setCheckError(err instanceof Error ? err.message : 'The check could not run.');
      } finally {
        setRunning(false);
      }
    },
    [key],
  );

  // The check starts by itself once per setup.
  useEffect(() => {
    if (!setup || started.current === setup.publicKey) return;
    started.current = setup.publicKey;
    run(`https://${setup.domain}/`);
  }, [setup, run]);

  /** Index of the step the check stopped at (the first failure), or -1. Nothing after it is shown. */
  const stoppedAt = result ? result.checks.findIndex((c) => c.status === 'fail') : -1;
  const lastShown = result ? (stoppedAt >= 0 ? stoppedAt + 1 : result.checks.length) : 0;

  // Reveal the results one by one, up to the step that failed.
  useEffect(() => {
    if (!result || shown >= lastShown) return;
    const t = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 150 : STEP_MS);
    return () => clearTimeout(t);
  }, [result, shown, lastShown]);

  const revealed = !!result && shown >= lastShown;
  const received = !!seen;
  const passed = revealed && result!.ok;
  const failed = revealed && !result!.ok;

  // Every step passed and the first pageview has now arrived: check once more, so the server saves the site.
  useEffect(() => {
    if (!passed || !received || verified || running || rechecked.current) return;
    rechecked.current = true;
    run(result!.url, false);
  }, [passed, received, verified, running, result, run]);

  const allGood = passed && verified;

  // A failed check ends the list at the failing step: the steps after it are not shown at all.
  const steps: Step[] = (failed ? CHECKS.slice(0, stoppedAt + 1) : CHECKS).map((c, i) => {
    const r = result?.checks.find((x) => x.id === c.id);
    if (r && i < shown) return { id: c.id, label: r.label, state: r.status, message: r.message };
    const isNext = (running && !result && i === 0) || (!!result && i === shown);
    return { id: c.id, label: c.label, state: isNext ? 'running' : 'waiting' };
  });
  if (!failed)
    steps.push(
      passed && received
        ? {
            id: 'pageview',
            label: 'First pageview received',
            state: 'pass',
            message: `On ${seen!.path} at ${new Date(seen!.at).toLocaleTimeString()}. ${verified ? 'Your site is saved and live.' : 'Saving your site…'}`,
          }
        : {
            id: 'pageview',
            label: 'Waiting for your first pageview',
            state: passed ? 'running' : 'waiting',
            message: passed ? (pollError ?? 'Open your site in a new tab: the first visit shows up here within a minute.') : undefined,
          },
    );
  /** All steps, the first pageview included. */
  const total = CHECKS.length + 1;
  const done = failed ? stoppedAt : steps.filter((s) => s.state === 'pass').length;

  return {
    steps,
    total,
    /** Step number (1-based) the check stopped at, or null. */
    stoppedAt: failed ? stoppedAt + 1 : null,
    progress: failed ? Math.max(stoppedAt, 0.5) / total : done / total,
    done,
    url,
    setUrl,
    run,
    running,
    checkError,
    revealed,
    received,
    allGood,
    failed,
    passed,
    verified,
    saved,
  };
}
