import {
  CONTRACT_VERSION,
  LIMITS,
  PIXEL_FIELDS,
  PIXEL_NUMERIC_FIELDS,
  checkWire,
  deriveSalt,
  parseWire,
  previousUtcDate,
  utcDate,
  visitorHash,
} from '@tailwatch/contract';

import type {
  DropOutcome,
  DropQueueMessage,
  EdgeMeta,
  Outcome,
  QueueMessage,
  SiteConfig,
  VisitorHashes,
} from '@tailwatch/contract';

interface SiteConfigKV {
  get(key: string, options?: { cacheTtl?: number }): Promise<string | null>;
}

interface QueueBinding {
  send(message: QueueMessage): Promise<void>;
}

interface RateLimitBinding {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}

interface Env {
  SITE_CONFIG: SiteConfigKV;
  EVENTS: QueueBinding;
  /** Per-site limiter (keyed by public key). */
  RATE_LIMITER?: RateLimitBinding;
  /** Per-client limiter. The key is held only by Cloudflare's limiter, never by us. */
  RATE_LIMITER_IP?: RateLimitBinding;
  /** Region this deployment serves ('in' | 'in-eu'). A site key is valid only in its own region. */
  REGION?: string;
  /** Local/staging seed only. Production site configuration always comes from KV. */
  DEV_SITE_CONFIG?: string;
  /**
   * "true" adds the x-tw-dropped reason header to responses (local / staging only).
   * Unset in production: a reason header would tell anyone whether a site key exists (STAGE-1 D2).
   */
  EXPOSE_DROP_REASON?: string;
  /**
   * Milliseconds to collect identical drops (same site, reason, detail, country, ASN) into ONE queue
   * message per isolate (wrangler.toml: 5000). Unset or 0 = one message per drop. A bot flood then costs
   * a handful of queue operations instead of one per hit (Free plan: about 3,300 messages a day).
   */
  DROP_BATCH_MS?: string;
}

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

const PIXEL = new Uint8Array([
  71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255,
  255, 33, 249, 4, 1, 0, 0, 0, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2,
  2, 68, 1, 0, 59,
]);

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'cache-control': 'no-store',
};

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const TEXT_CONTENT_TYPE = 'text/plain; charset=utf-8';
const RETRY_AFTER_SECONDS = '10';

/** KV's minimum cacheTtl is 60 s: site config may lag about a minute (PLAN 2.4). */
const SITE_CONFIG_CACHE_TTL = 60;


function response(status: number, body: BodyInit | null = null, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { ...CORS_HEADERS, ...headers } });
}

const noContent = (headers: Record<string, string> = {}) => response(204, null, headers);

function pixelResponse(): Response {
  return response(200, PIXEL, {
    'content-type': 'image/gif',
    'content-length': String(PIXEL.byteLength),
  });
}

/** The drop-reason header, only where the deployment opted in (STAGE-1 D2). */
function dropHeaders(env: Env, reason: string): Record<string, string> {
  return env.EXPOSE_DROP_REASON === 'true' ? { 'x-tw-dropped': reason } : {};
}

function outcomeResponse(outcome: Outcome, pixel: boolean, env: Env): Response {
  switch (outcome.kind) {
    case 'accept':
      return pixel ? pixelResponse() : noContent();
    case 'duplicate':
      return pixel ? pixelResponse() : noContent();
    case 'drop':
      // Identical to an accept for the caller (invariant 8). The reason reaches the customer
      // through the queued drop message and dropped_hits, not through the response.
      return pixel ? pixelResponse() : noContent(dropHeaders(env, outcome.reason));
    case 'reject':
      return response(outcome.status, outcome.error, { 'content-type': TEXT_CONTENT_TYPE });
    case 'rate_limit':
      return response(429, outcome.error, {
        'content-type': TEXT_CONTENT_TYPE,
        'retry-after': outcome.headers['Retry-After'],
      });
    case 'quota_limited':
      return response(200, JSON.stringify({ quota_limited: outcome.quotaLimited }), {
        'content-type': JSON_CONTENT_TYPE,
      });
  }
}

const rateLimitedOutcome = (): Outcome => ({
  kind: 'rate_limit',
  status: 429,
  reason: 'rate_limited',
  error: 'rate_limited',
  headers: { 'Retry-After': RETRY_AFTER_SECONDS },
});

/**
 * Reads the body with a hard byte cap. Content-Length is only a hint (chunked requests
 * omit it), so the stream itself is counted and cancelled the moment it crosses the cap.
 * Returns null when oversized.
 */
async function readBody(request: Request): Promise<string | null> {
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

function queryPayload(request: Request): string {
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

function isSiteConfig(value: unknown): value is SiteConfig {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'number' &&
    Number.isSafeInteger(v.id) &&
    typeof v.publicKey === 'string' &&
    Array.isArray(v.allowedHosts) &&
    v.allowedHosts.every((h) => typeof h === 'string') &&
    typeof v.live === 'boolean' &&
    (v.region === 'in' || v.region === 'in-eu') &&
    (v.identitySecret === undefined || typeof v.identitySecret === 'string')
  );
}

function parseSite(raw: string | null | undefined, publicKey: string): SiteConfig | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isSiteConfig(parsed) && parsed.publicKey === publicKey ? parsed : null;
  } catch {
    return null;
  }
}

async function readSiteConfig(env: Env, publicKey: string): Promise<SiteConfig | null> {
  let raw: string | null = null;
  try {
    raw = await env.SITE_CONFIG.get(`site:${publicKey}`, { cacheTtl: SITE_CONFIG_CACHE_TTL });
  } catch (error) {
    // KV outage: behave like "unknown site" for the browser, but leave a trace for operators.
    log('kv_read_failed', error);
    return null;
  }
  // The hardcoded seed is a local/staging fallback only. Production has no seed.
  const site = parseSite(raw, publicKey) ?? parseSite(env.DEV_SITE_CONFIG, publicKey);
  // A key is valid only in its own region (PLAN 2.4). Wrong region == unknown site.
  if (site && env.REGION && site.region !== env.REGION) return null;
  return site;
}

function edgeMeta(request: Request, site: SiteConfig | null, receivedAt: number): EdgeMeta {
  const cf = (request as Request & { cf?: { country?: string; asn?: number; asOrganization?: string } }).cf;
  // https: browsers send client hints (Sec-CH-UA) only over TLS; the consumer's headless scoring needs to know.
  const https = request.url.startsWith('https:');
  return { receivedAt, site, country: cf?.country, asn: cf?.asn, asOrganization: cf?.asOrganization, https };
}

async function allowed(limiter: RateLimitBinding | undefined, key: string): Promise<boolean> {
  if (!limiter) return true;
  try {
    return (await limiter.limit({ key })).success;
  } catch (error) {
    // A broken limiter must not take collection down.
    log('rate_limiter_failed', error);
    return true;
  }
}

function log(event: string, error?: unknown): void {
  // Never log request data: no IP, no UA, no URL, no payload (invariant 12).
  console.error(JSON.stringify({ tw: event, error: error instanceof Error ? error.name : undefined }));
}

/**
 * Daily salts are derived with HMAC; cache them per isolate so a hit costs two SHA-256
 * digests instead of two HMAC key imports plus two digests. Keyed by secret+date so a
 * rotated secret can never reuse a stale salt.
 */
const saltCache = new Map<string, string>();
const SALT_CACHE_MAX = 2000;

async function saltFor(secret: string, date: string): Promise<string> {
  const key = `${secret}|${date}`;
  const hit = saltCache.get(key);
  if (hit) return hit;
  const salt = await deriveSalt(secret, date);
  if (saltCache.size >= SALT_CACHE_MAX) saltCache.clear();
  saltCache.set(key, salt);
  return salt;
}

async function visitorHashes(
  secret: string,
  receivedAt: number,
  ip: string,
  userAgent: string,
  siteId: string,
): Promise<VisitorHashes> {
  const [today, yesterday] = await Promise.all([
    saltFor(secret, utcDate(receivedAt)),
    saltFor(secret, previousUtcDate(receivedAt)),
  ]);
  const [hash, prevHash] = await Promise.all([
    visitorHash(today, ip, userAgent, siteId),
    visitorHash(yesterday, ip, userAgent, siteId),
  ]);
  return { hash, prevHash };
}

/** One retry, then give up loudly. The browser has already been answered. */
async function enqueue(env: Env, message: QueueMessage): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await env.EVENTS.send(message);
      return;
    } catch (error) {
      if (attempt === 1) log('queue_send_failed', error);
    }
  }
}

/** Drops being collected in this isolate, waiting for their single queue message. */
const pendingDrops = new Map<string, DropQueueMessage>();
const PENDING_DROPS_MAX = 500;

/**
 * Queues a drop message, or, with DROP_BATCH_MS, adds it to an identical one already waiting in this
 * isolate. The first drop of a kind sends the batched message after the window (ctx.waitUntil keeps the
 * invocation alive; the Free plan allows 30 s). Counts are kept, so nothing disappears from the feed.
 */
function queueDrop(env: Env, ctx: ExecutionContextLike, message: QueueMessage): void {
  const windowMs = Number(env.DROP_BATCH_MS ?? 0);
  if (message.type !== 'drop' || !(windowMs > 0 && windowMs <= 25_000)) {
    ctx.waitUntil(enqueue(env, message));
    return;
  }
  const key = [message.siteId, message.reason, message.detail ?? '', message.country ?? '', message.asn ?? 0].join('|');
  const waiting = pendingDrops.get(key);
  if (waiting) {
    waiting.hits = (waiting.hits ?? 1) + 1;
    return;
  }
  if (pendingDrops.size >= PENDING_DROPS_MAX) {
    ctx.waitUntil(enqueue(env, message));
    return;
  }
  pendingDrops.set(key, { ...message, hits: 1 });
  ctx.waitUntil(
    new Promise((resolve) => setTimeout(resolve, windowMs)).then(() => {
      const batched = pendingDrops.get(key);
      pendingDrops.delete(key);
      return batched ? enqueue(env, batched) : undefined;
    }),
  );
}

function dropMessage(outcome: DropOutcome, at: number): QueueMessage | null {
  // not_found has no siteId on purpose: nothing to attribute it to.
  if (!outcome.siteId) return null;
  return {
    v: 1,
    type: 'drop',
    at,
    siteId: outcome.siteId,
    reason: outcome.reason,
    detail: outcome.detail,
    country: outcome.country,
    asn: outcome.asn,
  };
}

async function collect(
  request: Request,
  env: Env,
  ctx: ExecutionContextLike,
  pixel: boolean,
): Promise<Response> {
  const ip = request.headers.get('cf-connecting-ip');

  // 1. Cheapest check first: per-client limiter, before the body is even read.
  if (ip && !(await allowed(env.RATE_LIMITER_IP, `ip:${ip}`))) {
    return outcomeResponse(rateLimitedOutcome(), pixel, env);
  }

  // 2. Size cap, counted on the stream (413 before parsing).
  const body = pixel ? queryPayload(request) : await readBody(request);
  if (body === null) {
    return outcomeResponse({ kind: 'reject', status: 413, reason: 'oversized', error: 'body_too_large' }, pixel, env);
  }

  // 3. Parse + shape check (400 / 413).
  const parsed = parseWire(body);
  if (!parsed.ok) return outcomeResponse(parsed.outcome, pixel, env);

  // 4. Per-site limiter, before the KV lookup so unknown-key floods cannot reach the Queue.
  if (!(await allowed(env.RATE_LIMITER, `site:${parsed.payload.s}`))) {
    return outcomeResponse(rateLimitedOutcome(), pixel, env);
  }

  // 5. Site lookup, host check, GPC, cheap bot reject (contract).
  const site = await readSiteConfig(env, parsed.payload.s);
  const receivedAt = Date.now();
  const outcome = checkWire(request.headers, parsed, edgeMeta(request, site, receivedAt));

  if (outcome.kind === 'drop') {
    const message = dropMessage(outcome, receivedAt);
    if (message) queueDrop(env, ctx, message);
    return outcomeResponse(outcome, pixel, env);
  }
  if (outcome.kind !== 'accept') return outcomeResponse(outcome, pixel, env);

  // 6. Privacy: no event is queued without a per-site secret and a client address.
  //    The raw IP lives only inside this hash computation.
  if (!site?.identitySecret || !ip) {
    const message = dropMessage(
      {
        kind: 'drop',
        status: 204,
        reason: 'identity_unavailable',
        headers: { 'x-tw-dropped': 'identity_unavailable' },
        siteId: outcome.event.siteId,
        country: outcome.event.country,
        asn: outcome.event.asn,
      },
      receivedAt,
    );
    if (message) queueDrop(env, ctx, message);
    return pixel ? pixelResponse() : noContent(dropHeaders(env, 'identity_unavailable'));
  }

  // 7. Respond now, hash + enqueue after (ctx.waitUntil).
  const secret = site.identitySecret;
  const userAgent = request.headers.get('user-agent') ?? '';
  ctx.waitUntil(
    visitorHashes(secret, outcome.event.receivedAt, ip, userAgent, String(outcome.event.siteId))
      .then((visitor) => enqueue(env, { v: 1, type: 'event', event: outcome.event, visitor }))
      .catch((error) => log('hash_failed', error)),
  );
  return outcomeResponse(outcome, pixel, env);
}

async function route(request: Request, env: Env, ctx: ExecutionContextLike): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (pathname === '/health' && request.method === 'GET') {
    return response(200, 'ok', {
      'content-type': TEXT_CONTENT_TYPE,
      'x-tw-contract': String(CONTRACT_VERSION),
    });
  }
  if (request.method === 'OPTIONS') return noContent();
  if (pathname === '/e.gif' && request.method === 'GET') return collect(request, env, ctx, true);
  if (pathname === '/e' && request.method === 'POST') return collect(request, env, ctx, false);
  return response(404);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContextLike): Promise<Response> {
    try {
      return await route(request, env, ctx);
    } catch (error) {
      // Safety net: whatever goes wrong inside, the browser never sees a 5xx or our internals.
      log('unhandled', error);
      return noContent(dropHeaders(env, 'internal'));
    }
  },
} satisfies ExportedHandler<Env>;
