/** An error the client is meant to see: HTTP status, a stable machine code, and a sentence for people. */
export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** The answer when analytics (ClickHouse) cannot be read. */
export const analyticsUnavailable = () => new HttpError(503, 'analytics_unavailable', 'We could not read your analytics right now. Try again in a moment.');

/** `error.message` for logs, whatever was thrown. */
export const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** One JSON line for the logs (Vercel / Render show them as is). */
export const logError = (tw: string, fields: Record<string, unknown>) => console.error(JSON.stringify({ tw, ...fields }));
export const logInfo = (tw: string, fields: Record<string, unknown>) => console.log(JSON.stringify({ tw, ...fields }));
