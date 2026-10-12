import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { Site, Status, VerifyResult } from '../api/client';
import type { Step } from '../components/onboarding/CheckList';

const POLL_MS = 3000;
/** Pause between two steps turning green: quick, but slow enough to follow. */
const STEP_MS = 380;

/** The verifier's steps, in the order the server runs them (apps/api/src/verifier.ts). */
export const CHECKS: { id: string; label: string }[] = [
  { id: 'reach', label: 'Site reachable' },
  { id: 'present', label: 'Snippet in page source' },
  { id: 'noscript', label: 'Not in noscript or a comment' },
  { id: 'once', label: 'Only one snippet' },
  { id: 'id', label: 'Site key matches' },
  { id: 'script', label: 'Script loads' },
  { id: 'csp', label: 'Content-Security-Policy allows it' },
];

/** Only http(s) pages can be opened from the result; anything else typed into the field is ignored for the link. */
export const safePageUrl = (u: string) => (/^https?:\/\//i.test(u.trim()) ? u.trim() : null);

/**
 * Step 3, "Verify": two checks at once.
 *  - passive: asks every 3 s whether a first pageview has arrived (stops when it has);
 *  - active: the server opens the page like a visitor and runs 7 checks; starts by itself once, again on
 *    "Check again". The results are revealed one by one.
 * `allGood` = everything passed and a pageview arrived (a tag added by Google Tag Manager is not in the
 * page source: there the first pageview alone is the proof).
 */
export function useInstallCheck(site: Site | null, onVerified: (site: Site) => void) {
  const [status, setStatus] = useState<Status | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [url, setUrl] = useState(site ? `https://${site.domain}/` : '');
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [shown, setShown] = useState(0);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const started = useRef<number | null>(null);
  const siteId = site?.id;
  const verified = useRef(onVerified);
  verified.current = onVerified;

  // Another site selected while on this page: start over for that site.
  useEffect(() => {
    if (!site) return;
    setStatus(null);
    setResult(null);
    setShown(0);
    setUrl(`https://${site.domain}/`);
  }, [siteId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Passive: "waiting for your first pageview" until one arrives.
  useEffect(() => {
    if (!site) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const s = await api.status(site.id);
        if (!live) return;
        setStatus(s);
        setPollError(null);
        if (s.verifiedAt && !site.verifiedAt) verified.current({ ...site, verifiedAt: s.verifiedAt });
        if (s.pageviews > 0) return; // got it: stop asking
      } catch (e) {
        if (live) setPollError(e instanceof Error ? e.message : 'Status unavailable.');
      }
      if (live) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [siteId]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = useCallback(
    async (target: string) => {
      if (!siteId) return;
      setRunning(true);
      setCheckError(null);
      setResult(null);
      setShown(0);
      try {
        setResult(await api.verify(siteId, target));
      } catch (err) {
        setCheckError(err instanceof Error ? err.message : 'The check could not run.');
      } finally {
        setRunning(false);
      }
    },
    [siteId],
  );

  // Active: starts by itself once per site.
  useEffect(() => {
    if (!site || started.current === site.id) return;
    started.current = site.id;
    run(`https://${site.domain}/`);
  }, [site, run]);

  // Reveal the results one by one.
  useEffect(() => {
    if (!result || shown >= result.checks.length) return;
    const t = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 150 : STEP_MS);
    return () => clearTimeout(t);
  }, [result, shown]);

  const revealed = !!result && shown >= result.checks.length;
  const received = !!status && status.pageviews > 0 && !!status.last;
  const noTagOnly = !!result && result.checks.find((c) => c.id === 'present')?.status === 'fail';
  const allGood = revealed && received && (result!.ok || noTagOnly);
  const failed = revealed && !result!.ok && !(noTagOnly && received);

  const steps: Step[] = CHECKS.map((c, i) => {
    const r = result?.checks.find((x) => x.id === c.id);
    if (r && i < shown) return { id: c.id, label: r.label, state: r.status, message: r.message };
    const isNext = (running && i === 0) || (!!result && i === shown);
    return { id: c.id, label: c.label, state: isNext ? 'running' : 'waiting' };
  });
  steps.push(
    received
      ? {
          id: 'pageview',
          label: 'First pageview received',
          state: revealed || !result ? 'pass' : 'waiting',
          message: `On ${status!.last!.path} at ${new Date(status!.last!.at).toLocaleTimeString()}. Your site is live.`,
        }
      : {
          id: 'pageview',
          label: 'Waiting for your first pageview',
          state: revealed ? 'running' : 'waiting',
          message: revealed ? (pollError ?? 'Open your site in a new tab: the first visit shows up here within a minute.') : undefined,
        },
  );
  const done = steps.filter((s) => s.state === 'pass' || s.state === 'fail' || s.state === 'skip').length;

  return {
    steps,
    progress: done / steps.length,
    done,
    status,
    url,
    setUrl,
    run,
    running,
    checkError,
    revealed,
    received,
    allGood,
    failed,
  };
}
