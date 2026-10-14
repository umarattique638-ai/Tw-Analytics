/**
 * Active install check (BUILD-ORDER Part 1 ⑤). Fetches the customer's page as TailwatchVerifier/1.0
 * (on the edge bot denylist, so a check never counts as a visit) and reports exactly which step failed.
 */
export const VERIFIER_USER_AGENT = 'TailwatchVerifier/1.0 (+install check; never counted)';

export type CheckId = 'reach' | 'present' | 'noscript' | 'once' | 'id' | 'script' | 'csp';
export interface CheckResult {
  id: CheckId;
  label: string;
  status: 'pass' | 'fail' | 'skip';
  message: string;
}
export interface ActiveResult {
  url: string;
  ok: boolean;
  checks: CheckResult[];
}

export interface FoundTag {
  src: string;
  key: string | null;
  api: string | null;
  hidden: 'comment' | 'noscript' | null;
}

/** The step names, in the order they run (the dashboard shows the same list). */
export const LABELS: Record<CheckId, string> = {
  reach: 'Site reachable',
  present: 'Snippet in page source',
  noscript: 'Not in noscript or a comment',
  once: 'Only one snippet',
  id: 'Site key matches',
  script: 'Script loads',
  csp: 'Content-Security-Policy allows it',
};

export interface VerifierOptions {
  fetchImpl?: typeof fetch;
  /** Tests and local development only: allow pages on private addresses. */
  allowPrivate?: boolean;
  resolve?: (host: string) => Promise<string[]>;
}

/** The URL the user typed cannot be checked (not a URL, not http(s), not one of the site's hosts). */
export class VerifyInputError extends Error {}
