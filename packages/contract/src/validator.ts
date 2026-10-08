import { edgeBotReason } from './bots';

import {
  EVENT_NAME_RE,
  LIMITS,
  SITE_KEY_RE,
  stripControlChars,
  UNSAFE_PROP_KEYS,
} from './limits';

import {
  hostAllowed,
  normalizeUrl,
} from './url';

import type { PropValue } from './types';

import {
  FLAG_AUTOMATION,
  FLAG_HASH_ROUTE,
  isKnownWireField,
} from './wire';

import type { WirePayload } from './wire';

import type {
  ClientHints,
  DropReason,
  EdgeMeta,
  HeaderReader,
  Outcome,
  ValidatedEvent,
} from './outcome';

const encoder = new TextEncoder();

/**
 * ClickHouse DateTime64 holds 1900-01-01 .. 2299-12-31. Anything outside this
 * range would make an INSERT fail, so no stored time may leave it.
 */
const STORABLE_MIN_MS = Date.UTC(1900, 0, 1);
const STORABLE_MAX_MS = Date.UTC(2299, 11, 31);

/** Unknown fields are retained, but never deeper than this (stack safety). */
const MAX_EXTRA_DEPTH = 8;

const isInteger = (
  value: unknown,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= min &&
  value <= max;

const isString = (
  value: unknown,
  maxLength: number,
): value is string =>
  typeof value === 'string' &&
  value.length <= maxLength;

const isTimestamp = (
  value: unknown,
): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value > 0;

function shapeError(
  object: Record<string, unknown>,
): string | null {
  if (
    typeof object.s !== 'string' ||
    !SITE_KEY_RE.test(object.s)
  ) {
    return 'bad_site_key';
  }

  if (
    typeof object.n !== 'string' ||
    !EVENT_NAME_RE.test(object.n)
  ) {
    return 'bad_event_name';
  }

  if (
    !isString(
      object.u,
      LIMITS.maxUrlLength,
    ) ||
    object.u.length === 0
  ) {
    return 'bad_url';
  }

  if (!isInteger(object.q, 1, LIMITS.maxSequence)) {
    return 'bad_seq';
  }

  if (!isTimestamp(object.t)) {
    return 'bad_timestamp';
  }

  if (
    !isInteger(
      object.v,
      0,
      LIMITS.maxVersion,
    )
  ) {
    return 'bad_version';
  }

  if (
    object.r !== undefined &&
    !isString(
      object.r,
      LIMITS.maxReferrerLength,
    )
  ) {
    return 'bad_referrer';
  }

  if (
    object.e !== undefined &&
    !isInteger(
      object.e,
      0,
      LIMITS.maxEngagementMs,
    )
  ) {
    return 'bad_engagement';
  }

  if (
    object.rt !== undefined &&
    !isString(
      object.rt,
      LIMITS.maxRouteLength,
    )
  ) {
    return 'bad_route';
  }

  if (
    object.w !== undefined &&
    !isInteger(
      object.w,
      0,
      LIMITS.maxScreenWidth,
    )
  ) {
    return 'bad_width';
  }

  if (
    object.i !== undefined &&
    !isString(
      object.i,
      LIMITS.maxInsertIdLength,
    )
  ) {
    return 'bad_insert_id';
  }

  if (
    object.x !== undefined &&
    !isTimestamp(object.x)
  ) {
    return 'bad_sent_at';
  }

  if (
    object.f !== undefined &&
    !isInteger(
      object.f,
      0,
      LIMITS.maxFlags,
    )
  ) {
    return 'bad_flags';
  }

  if (object.p !== undefined) {
    if (
      typeof object.p !== 'object' ||
      object.p === null ||
      Array.isArray(object.p)
    ) {
      return 'bad_props';
    }
  }

  return null;
}

function cleanProps(
  value: unknown,
): {
  props: Record<string, PropValue>;
  warnings: string[];
} {
  const props: Record<
    string,
    PropValue
  > = {};

  const warnings: string[] = [];

  if (!value) {
    return {
      props,
      warnings,
    };
  }

  const entries = Object.entries(
    value as Record<
      string,
      unknown
    >,
  );

  if (
    entries.length >
    LIMITS.maxProps
  ) {
    warnings.push(
      `props_truncated:${entries.length}`,
    );
  }

  for (
    const [key, propValue] of entries.slice(
      0,
      LIMITS.maxProps,
    )
  ) {
    const cleanedKey =
      stripControlChars(key);

    if (
      key.length === 0 ||
      key.length >
        LIMITS.maxPropKeyLength ||
      UNSAFE_PROP_KEYS.has(key) ||
      cleanedKey !== key
    ) {
      warnings.push(
        'prop_key_invalid',
      );
      continue;
    }

    if (
      typeof propValue === 'string'
    ) {
      const cleanedValue =
        stripControlChars(
          propValue,
        );

      if (
        cleanedValue.length >
        LIMITS.maxPropValueLength
      ) {
        warnings.push(
          `prop_value_too_long:${key}`,
        );
        continue;
      }

      props[key] = cleanedValue;
      continue;
    }

    if (
      typeof propValue === 'number' &&
      Number.isFinite(propValue)
    ) {
      props[key] = propValue;
      continue;
    }

    if (
      typeof propValue === 'boolean'
    ) {
      props[key] = propValue;
      continue;
    }

    warnings.push(
      `prop_type_invalid:${key}`,
    );
  }

  return {
    props,
    warnings,
  };
}

function reject(
  status: 400,
  error: string,
): Outcome;

function reject(
  status: 413,
  error: string,
): Outcome;

function reject(
  status: 400 | 413,
  error: string,
): Outcome {
  if (status === 413) {
    return {
      kind: 'reject',
      status: 413,
      reason: 'oversized',
      error,
    };
  }

  return {
    kind: 'reject',
    status: 400,
    reason: 'malformed',
    error,
  };
}

const drop = (
  reason: DropReason,
  edge: EdgeMeta,
  detail?: string,
): Outcome => ({
  kind: 'drop',
  status: 204,
  reason,
  detail: detail
    ? stripControlChars(
        detail,
      ).slice(
        0,
        LIMITS.maxDropDetailLength,
      )
    : undefined,
  headers: {
    'x-tw-dropped': reason,
  },
  siteId:
    reason === 'not_found'
      ? undefined
      : edge.site?.id,
  country: edge.country,
  asn: edge.asn,
});

export type ParseResult =
  | {
      ok: true;
      payload: WirePayload;
      raw: Record<string, unknown>;
    }
  | {
      ok: false;
      outcome: Outcome;
    };

export function parseWire(
  body: string,
): ParseResult {
  if (
    encoder.encode(body).byteLength >
    LIMITS.maxBodyBytes
  ) {
    return {
      ok: false,
      outcome: reject(
        413,
        'body_too_large',
      ),
    };
  }

  let raw: unknown;

  try {
    raw = JSON.parse(body);
  } catch {
    return {
      ok: false,
      outcome: reject(
        400,
        'invalid_json',
      ),
    };
  }

  if (
    typeof raw !== 'object' ||
    raw === null ||
    Array.isArray(raw)
  ) {
    return {
      ok: false,
      outcome: reject(
        400,
        'not_an_object',
      ),
    };
  }

  const object =
    raw as Record<
      string,
      unknown
    >;

  const error = shapeError(
    object,
  );

  if (error) {
    return {
      ok: false,
      outcome: reject(
        400,
        error,
      ),
    };
  }

  return {
    ok: true,
    payload:
      object as unknown as WirePayload,
    raw: object,
  };
}

function resolveTimes(
  createdAt: number,
  sentAt: number | undefined,
  receivedAt: number,
): {
  occurredAt: number;
  warnings: string[];
} {
  const warnings: string[] = [];

  let occurredAt =
    sentAt !== undefined
      ? receivedAt -
        (sentAt - createdAt)
      : createdAt;

  const newestAllowed =
    receivedAt +
    LIMITS.maxFutureSkewMs;

  if (occurredAt > newestAllowed) {
    occurredAt = receivedAt;

    warnings.push(
      'timestamp_repaired_future',
    );
  } else if (
    !(occurredAt >= STORABLE_MIN_MS)
  ) {
    /*
     * Not storable at all (before 1900, e.g. x - t is astronomically
     * large). Old-but-storable events are NEVER rewritten: they stay
     * as backfill. Only a value ClickHouse cannot hold is repaired,
     * and never silently: the warning reaches the customer's feed.
     */
    occurredAt = receivedAt;

    warnings.push(
      'timestamp_repaired_old',
    );
  }

  return {
    occurredAt,
    warnings,
  };
}

function passesLuhn(
  value: string,
): boolean {
  let sum = 0;
  let shouldDouble = false;

  for (
    let index = value.length - 1;
    index >= 0;
    index -= 1
  ) {
    let digit =
      Number(value[index]);

    if (shouldDouble) {
      digit *= 2;

      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

function isCardLikeValue(
  value: string,
): boolean {
  const candidates =
    value.match(
      /(?:\d[\d\s-]{11,24}\d|\d{13,19})/g,
    );

  if (!candidates) {
    return false;
  }

  for (
    const candidate of candidates
  ) {
    const digits =
      candidate.replace(
        /\D/g,
        '',
      );

    if (
      digits.length >= 13 &&
      digits.length <= 19 &&
      passesLuhn(digits)
    ) {
      return true;
    }
  }

  return false;
}

function isSensitiveProperty(
  value: string,
): boolean {
  if (
    isCardLikeValue(value)
  ) {
    return true;
  }

  if (
    /\b\d{3}-\d{2}-\d{4}\b/.test(
      value,
    )
  ) {
    return true;
  }

  return false;
}

function cleanEventProps(
  value: unknown,
): {
  props: Record<string, PropValue>;
  warnings: string[];
} {
  const cleaned =
    cleanProps(value);

  const props: Record<
    string,
    PropValue
  > = {};

  const warnings = [
    ...cleaned.warnings,
  ];

  for (
    const [key, propValue] of Object.entries(
      cleaned.props,
    )
  ) {
    if (
      typeof propValue === 'string' &&
      isSensitiveProperty(propValue)
    ) {
      warnings.push(
        `sensitive_prop_refused:${key}`,
      );

      continue;
    }

    props[key] = propValue;
  }

  return {
    props,
    warnings,
  };
}

function sanitizeExtraValue(
  value: unknown,
  depth = 0,
): unknown {
  if (
    typeof value === 'object' &&
    value !== null &&
    depth >= MAX_EXTRA_DEPTH
  ) {
    return null;
  }

  if (
    typeof value === 'string'
  ) {
    return stripControlChars(
      value,
    );
  }

  if (Array.isArray(value)) {
    return value.map((child) =>
      sanitizeExtraValue(
        child,
        depth + 1,
      ),
    );
  }

  if (
    typeof value === 'object' &&
    value !== null
  ) {
    const cleaned: Record<
      string,
      unknown
    > = {};

    for (
      const [key, child] of Object.entries(
        value as Record<
          string,
          unknown
        >,
      )
    ) {
      if (UNSAFE_PROP_KEYS.has(key)) {
        continue;
      }

      cleaned[key] =
        sanitizeExtraValue(
          child,
          depth + 1,
        );
    }

    return cleaned;
  }

  return value;
}

/**
 * A referrer is stored without query string, fragment or credentials:
 * password-reset links and search terms must not reach the event store.
 */
function sanitizeReferrer(
  value: string,
): string {
  const cleaned =
    stripControlChars(value);

  try {
    const url = new URL(cleaned);

    if (
      url.protocol === 'http:' ||
      url.protocol === 'https:'
    ) {
      return `${url.origin}${url.pathname}`;
    }
  } catch {
    // not an absolute URL: fall through
  }

  return cleaned.split(/[?#]/)[0] ?? '';
}

function cleanExtra(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const extra: Record<
    string,
    unknown
  > = {};

  for (
    const [key, value] of Object.entries(
      raw,
    )
  ) {
    if (
      isKnownWireField(key) ||
      UNSAFE_PROP_KEYS.has(key)
    ) {
      continue;
    }

    extra[key] =
      sanitizeExtraValue(value);
  }

  return extra;
}

const hint = (headers: HeaderReader, name: string): string | undefined => {
  const v = headers.get(name);
  return v ? stripControlChars(v).slice(0, 256) : undefined;
};

/** STAGE-1 A6: the few request headers the consumer's headless scoring needs. Never stored. */
function clientHints(headers: HeaderReader, edge: EdgeMeta): ClientHints {
  const out: ClientHints = { lang: !!headers.get('accept-language'), https: edge.https !== false };
  const chUa = hint(headers, 'sec-ch-ua');
  const chPlatform = hint(headers, 'sec-ch-ua-platform');
  const chMobile = hint(headers, 'sec-ch-ua-mobile');
  if (chUa !== undefined) out.chUa = chUa;
  if (chPlatform !== undefined) out.chPlatform = chPlatform;
  if (chMobile !== undefined) out.chMobile = chMobile;
  return out;
}

export function checkWire(
  headers: HeaderReader,
  parsed: Extract<
    ParseResult,
    { ok: true }
  >,
  edge: EdgeMeta,
): Outcome {
  const {
    payload,
    raw,
  } = parsed;

  /*
   * Normalize and validate the URL before looking up
   * the site. This prevents malformed URLs from becoming
   * a tenant-existence oracle.
   */
  const normalized =
    normalizeUrl(
      payload.u,
      undefined,
      ((payload.f ?? 0) & FLAG_HASH_ROUTE) !== 0,
    );

  if (!normalized) {
    return reject(
      400,
      'bad_url',
    );
  }

  const site = edge.site;

  if (
    !site ||
    !site.live ||
    site.publicKey !== payload.s
  ) {
    return drop(
      'not_found',
      edge,
    );
  }

  if (
    !hostAllowed(
      normalized.host,
      site.allowedHosts,
    )
  ) {
    return drop(
      'hostname',
      edge,
      normalized.host,
    );
  }

  if (
    headers.get('sec-gpc') === '1'
  ) {
    return drop(
      'gpc',
      edge,
      'sec_gpc',
    );
  }

  const userAgent =
    headers.get('user-agent');

  const bot = edgeBotReason(
    userAgent,
    edge.asn,
  );

  if (bot) {
    return drop(
      bot.reason,
      edge,
      bot.detail,
    );
  }

  // STAGE-1 A6: the browser itself says it is driven by automation software. Unambiguous -> edge.
  if (((payload.f ?? 0) & FLAG_AUTOMATION) !== 0) {
    return drop('bot', edge, 'automation');
  }

  const timeResult =
    resolveTimes(
      payload.t,
      payload.x,
      edge.receivedAt,
    );

  const warningsFromTimes = [
    ...timeResult.warnings,
  ];

  let createdAt = payload.t;

  if (
    !(
      createdAt >= STORABLE_MIN_MS &&
      createdAt <= STORABLE_MAX_MS
    )
  ) {
    createdAt = timeResult.occurredAt;

    warningsFromTimes.push(
      'created_at_repaired',
    );
  }

  const propResult =
    cleanEventProps(
      payload.p,
    );

  const extra =
    cleanExtra(raw);

  const event: ValidatedEvent = {
    siteId: site.id,
    name: payload.n,
    url: normalized.href,
    host: normalized.host,
    path: normalized.path,
    route:
      payload.rt !== undefined
        ? stripControlChars(
            payload.rt,
          )
        : undefined,
    referrer:
      payload.r !== undefined
        ? sanitizeReferrer(
            payload.r,
          )
        : undefined,
    seq: payload.q,
    createdAt,
    occurredAt:
      timeResult.occurredAt,
    receivedAt:
      edge.receivedAt,
    backfill:
      edge.receivedAt -
        timeResult.occurredAt >
      LIMITS.backfillAfterMs,
    trackerVersion:
      payload.v,
    engagementMs:
      payload.e,
    width: payload.w,
    insertId:
      payload.i !== undefined
        ? stripControlChars(
            payload.i,
          )
        : undefined,
    flags:
      payload.f ?? 0,
    props:
      propResult.props,
    warnings: [
      ...warningsFromTimes,
      ...propResult.warnings,
    ],
    extra,
    userAgent: userAgent
      ? stripControlChars(
          userAgent,
        ).slice(
          0,
          LIMITS.maxUserAgentLength,
        )
      : undefined,
    country:
      edge.country,
    asn:
      edge.asn,
    asOrganization:
      edge.asOrganization
        ? stripControlChars(
            edge.asOrganization,
          )
        : undefined,
    hints: clientHints(headers, edge),
  };

  return {
    kind: 'accept',
    status: 204,
    event,
  };
}

export function validate(
  headers: HeaderReader,
  body: string,
  edge: EdgeMeta,
): Outcome {
  const parsed =
    parseWire(body);

  if (!parsed.ok) {
    return parsed.outcome;
  }

  try {
    return checkWire(
      headers,
      parsed,
      edge,
    );
  } catch {
    /* Last line of defence: malformed input must never become a 500. */
    return reject(
      400,
      'validation_failed',
    );
  }
}