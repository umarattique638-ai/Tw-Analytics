import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { Site, Status, VerifyResult } from '../api/client';
import type { Step } from '../components/onboarding/CheckList';

const POLL_MS = 3000;
/** Pause between two steps turning green: quick, but slow enough to follow. */
const STEP_MS = 380;
const NOT_CHECKED = 'Not checked: fix the step above first.';

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
 * Step 3, "Verify" (decision 24). The server opens the page like a visitor and runs 7 checks in the order a
 * browser goes through; the first failing step stops the check. The site is VERIFIED only when every step
 * passed AND a first pageview arrived; the server decides, on the check itself.
 *  - the check starts by itself once, and again on "Check again";
 *  - meanwhile this page asks every 3 s whether a pageview has arrived; when it does after a passing check,
 *    the check runs once more so the server can mark the site verified.
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
  const rechecked = useRef(false);
  const siteId = site?.id;
  const verified = !!site?.verifiedAt;
  const onSite = useRef(onVerified);
  onSite.current = onVerified;
  const current = useRef(site);
  current.current = site;

  // Another site selected while on this page: start over for that site.
  useEffect(() => {
    if (!site) return;
    setStatus(null);
    setResult(null);
    setShown(0);
    rechecked.current = false;
    setUrl(`https://${site.domain}/`);
  }, [siteId]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Waiting for your first pageview": asks until one arrives.
  useEffect(() => {
    if (!siteId) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const s = await api.status(siteId);
        if (!live) return;
        setStatus(s);
        setPollError(null);
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
  }, [siteId]);

  const run = useCallback(
    async (target: string, reveal = true) => {
      if (!siteId) return;
      setRunning(true);
      setCheckError(null);
      if (reveal) {
        setResult(null);
        setShown(0);
      }
      try {
        const r = await api.verify(siteId, target);
        setResult(r);
        if (!reveal) setShown(r.checks.length);
        const s = current.current;
        if (r.verifiedAt && s && !s.verifiedAt) onSite.current({ ...s, verifiedAt: r.verifiedAt });
      } catch (err) {
        setCheckError(err instanceof Error ? err.message : 'The check could not run.');
      } finally {
        setRunning(false);
      }
    },
    [siteId],
  );

  // The check starts by itself once per site.
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
  const passed = revealed && result!.ok;
  const failed = revealed && !result!.ok;

  // Every step passed and the first pageview has now arrived: check once more, so the server can verify.
  useEffect(() => {
    if (!passed || !received || verified || running || rechecked.current) return;
    rechecked.current = true;
    run(result!.url, false);
  }, [passed, received, verified, running, result, run]);

  const allGood = passed && verified;

  const steps: Step[] = CHECKS.map((c, i) => {
    const r = result?.checks.find((x) => x.id === c.id);
    if (r && i < shown) return { id: c.id, label: r.label, state: r.status, message: r.message };
    const isNext = (running && !result && i === 0) || (!!result && i === shown);
    return { id: c.id, label: c.label, state: isNext ? 'running' : 'waiting' };
  });
  steps.push(
    failed
      ? { id: 'pageview', label: 'First pageview received', state: 'skip', message: NOT_CHECKED }
      : passed && received
        ? {
            id: 'pageview',
            label: 'First pageview received',
            state: 'pass',
            message: `On ${status!.last!.path} at ${new Date(status!.last!.at).toLocaleTimeString()}. Your site is live.`,
          }
        : {
            id: 'pageview',
            label: 'Waiting for your first pageview',
            state: passed ? 'running' : 'waiting',
            message: passed ? (pollError ?? 'Open your site in a new tab: the first visit shows up here within a minute.') : undefined,
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
    passed,
    verified,
  };
}
