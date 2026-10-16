import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { Setup, Site, VerifyResult } from '../api/client';
import type { Step } from '../components/onboarding/CheckList';

/** Pause between two steps turning green: quick, but slow enough to follow. */
const STEP_MS = 380;
/** After the last step turns green: long enough to see it, then the dashboard opens. */
const DONE_MS = 900;

/** The verifier's steps, in the order the server runs them (apps/api/src/services/verifier/types.ts CHECK_ORDER). */
export const CHECKS: { id: string; label: string }[] = [
  { id: 'reach', label: 'Site reachable' },
  { id: 'present', label: 'Snippet in page source' },
  { id: 'noscript', label: 'Not in noscript or a comment' },
  { id: 'once', label: 'Only one snippet' },
  { id: 'script', label: 'Script loads' },
  { id: 'csp', label: 'Content-Security-Policy allows it' },
  { id: 'id', label: 'Site key matches' },
];


/**
 * Step 3, "Verify" (decisions 24, 25). The server opens the page like a visitor and runs 7 checks in the order a
 * browser goes through; the first failing step stops the check. When every step passes, the server saves the
 * site (verified) at once and returns it: before that nothing is stored anywhere. The check starts by itself
 * once, and again on "Check again".
 */
export function useInstallCheck(setup: Setup | null, onSaved: (site: Site) => void) {
  const [url, setUrl] = useState(setup ? `https://${setup.domain}/` : '');
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [saved, setSaved] = useState<Site | null>(null);
  const [shown, setShown] = useState(0);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const started = useRef<string | null>(null);
  const key = setup?.publicKey;
  const onSite = useRef(onSaved);
  onSite.current = onSaved;

  // Another setup started while on this page: start over for it.
  useEffect(() => {
    if (!setup) return;
    setResult(null);
    setShown(0);
    setUrl(`https://${setup.domain}/`);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = useCallback(
    async (target: string) => {
      if (!key) return;
      setRunning(true);
      setCheckError(null);
      setResult(null);
      setShown(0);
      try {
        const r = await api.verifySetup(target);
        setResult(r);
        if (r.site) setSaved(r.site);
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
  const passed = revealed && result!.ok;
  const failed = revealed && !result!.ok;
  const allGood = passed && !!saved;

  // Every step is shown green and the site is saved: a moment to see it, then hand it over (the dashboard opens).
  useEffect(() => {
    if (!allGood || !saved) return;
    const t = setTimeout(() => onSite.current(saved), DONE_MS);
    return () => clearTimeout(t);
  }, [allGood, saved]);

  // A failed check ends the list at the failing step: the steps after it are not shown at all.
  const steps: Step[] = (failed ? CHECKS.slice(0, stoppedAt + 1) : CHECKS).map((c, i) => {
    const r = result?.checks.find((x) => x.id === c.id);
    if (r && i < shown) return { id: c.id, label: r.label, state: r.status, message: r.message };
    const isNext = (running && !result && i === 0) || (!!result && i === shown);
    return { id: c.id, label: c.label, state: isNext ? 'running' : 'waiting' };
  });
  const total = CHECKS.length;
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
    allGood,
    failed,
    passed,
    saved,
  };
}
