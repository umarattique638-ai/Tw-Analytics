/** Fixed-window limiter in memory: enough for one API process (a shared store comes with scale-out). */
export class Limiter {
  private hits = new Map<string, { n: number; until: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Counts one attempt for `key`; false once the window's allowance is used up. */
  take(key: string, now: number): boolean {
    const h = this.hits.get(key);
    if (!h || h.until <= now) {
      if (this.hits.size > 10_000) this.hits.clear();
      this.hits.set(key, { n: 1, until: now + this.windowMs });
      return true;
    }
    h.n += 1;
    return h.n <= this.max;
  }
}

const MIN = 60_000;

/** Every limiter of one API instance. */
export function createLimiters() {
  return {
    login: new Limiter(10, 15 * MIN),
    /** Per address, across e-mails: stops one machine from guessing many accounts' passwords. */
    loginIp: new Limiter(30, 15 * MIN),
    signup: new Limiter(20, 60 * MIN),
    /** Reset e-mails: a few per address an hour, so the form cannot be used to flood someone's inbox. */
    forgot: new Limiter(3, 60 * MIN),
    forgotIp: new Limiter(10, 60 * MIN),
    /** "Send the verification link again": a few per address an hour (it e-mails someone). */
    verifyMail: new Limiter(3, 60 * MIN),
    verifyMailIp: new Limiter(10, 60 * MIN),
    /** The verifier fetches other people's servers: a few checks a minute per account and per address. */
    verify: new Limiter(20, 10 * MIN),
    verifyIp: new Limiter(40, 10 * MIN),
    /** Password checks of "delete account": its own counter, so it can neither lock out nor bypass sign-in. */
    deleteAccount: new Limiter(5, 15 * MIN),
  };
}
export type Limiters = ReturnType<typeof createLimiters>;
