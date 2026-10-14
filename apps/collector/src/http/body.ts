import { LIMITS, PIXEL_FIELDS, PIXEL_NUMERIC_FIELDS } from '@tailwatch/contract';

/**
 * Reads the body with a hard byte cap. Content-Length is only a hint (chunked requests
 * omit it), so the stream itself is counted and cancelled the moment it crosses the cap.
 * Returns null when oversized.
 */
export async function readBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > LIMITS.maxBodyBytes) return null;
  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > LIMITS.maxBodyBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** The pixel's query string as the same JSON body a POST would send (numbers as numbers). */
export function queryPayload(request: Request): string {
  const params = new URL(request.url).searchParams;
  const payload: Record<string, unknown> = {};
  for (const key of PIXEL_FIELDS) {
    const value = params.get(key);
    if (value !== null) payload[key] = value;
  }
  for (const key of PIXEL_NUMERIC_FIELDS) {
    const value = payload[key];
    if (typeof value === 'string') payload[key] = value.trim() === '' ? Number.NaN : Number(value);
  }
  return JSON.stringify(payload);
}
