/**
 * One JSON line for Cloudflare's logs. Never request data: no IP, no UA, no URL, no payload
 * (invariant 12); for an error only its name.
 */
export function log(event: string, error?: unknown): void {
  console.error(JSON.stringify({ tw: event, error: error instanceof Error ? error.name : undefined }));
}
