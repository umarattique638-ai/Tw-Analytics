/** Limits and lifetimes of the API, in one place (the dashboard reads several of them from the answers). */

/** Name of the session cookie. Clients without cookies send the same token as `Authorization: Bearer`. */
export const SESSION_COOKIE = 'tw_session';
/** "Has any event arrived in the last 30 min?" (BUILD-ORDER ⑤, passive check). */
export const PASSIVE_WINDOW_MINUTES = 30;
/** A "forgot password" link works this long. */
export const RESET_MINUTES = 60;
/** An e-mail verification link (sent at sign-up) works this long. */
export const VERIFY_EMAIL_HOURS = 24;
/** Reports (saved CSV exports) are deleted this many days after they were made (TTL index). */
export const EXPORT_KEEP_DAYS = 90;
/** Saved reports per site at one time: enough for daily exports for the whole 90 days, and then some. */
export const EXPORT_MAX = 200;
/** Activity-log entries are deleted this many days after they were written (TTL index). */
export const AUDIT_KEEP_DAYS = 400;
/** What the account deletion form must receive, typed by the user. */
export const DELETE_CONFIRMATION = 'DELETE';
/** Active keys a site may have at once (rotation needs two). */
export const MAX_ACTIVE_KEYS = 3;
/** Hosts a site may accept. */
export const MAX_ALLOWED_HOSTS = 50;
