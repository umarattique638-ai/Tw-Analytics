/** Small wording helpers for the activity log and e-mails (no HTTP, no database). */

/** "tw_pub_AbC1…": enough to tell keys apart in the activity log, never the whole key. */
export const shortKey = (k: string) => `${k.slice(0, 11)}…`;
export const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
/** count(2, 'site') -> "2 sites". */
export const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
