import { describe, expect, it } from 'vitest';

import {
  checkWire,
  parseWire,
  validate,
} from '../src/validator';

import type {
  EdgeMeta,
  HeaderReader,
  SiteConfig,
} from '../src/outcome';

const site: SiteConfig = {
  id: 123,
  publicKey:
    'tw_pub_12345678901234567890123456789012',
  allowedHosts: [
    'example.com',
    'www.example.com',
    '*.example.com',
  ],
  live: true,
  region: 'in',
};

const edge: EdgeMeta = {
  receivedAt: 1_760_000_000_000,
  site,
  country: 'PK',
  asn: 12345,
  asOrganization: 'Example ISP',
};

const headers = (
  values: Record<string, string> = {},
): HeaderReader => ({
  get(name: string): string | null {
    return (
      values[name.toLowerCase()] ??
      null
    );
  },
});

const payload = {
  s: site.publicKey,
  n: 'pageview',
  u: 'https://example.com/products/?utm_source=google&utm_medium=cpc',
  q: 1,
  t: 1_760_000_000_000,
  v: 1,
};

const body = (
  value: Record<string, unknown> = payload,
) => JSON.stringify(value);

function expectReject(
  result: ReturnType<typeof parseWire>,
  error: string,
) {
  expect(result.ok).toBe(false);

  if (!result.ok) {
    expect(result.outcome.kind).toBe(
      'reject',
    );

    if (
      result.outcome.kind ===
      'reject'
    ) {
      expect(
        result.outcome.error,
      ).toBe(error);
    }
  }
}

describe('parseWire', () => {
  it('accepts a valid payload', () => {
    const result = parseWire(body());

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.payload.s).toBe(
        site.publicKey,
      );

      expect(result.payload.n).toBe(
        'pageview',
      );

      expect(result.payload.q).toBe(1);
    }
  });

  it('rejects invalid JSON', () => {
    const result =
      parseWire('{invalid');

    expectReject(
      result,
      'invalid_json',
    );
  });

  it('rejects non-object JSON', () => {
    const result = parseWire(
      JSON.stringify([]),
    );

    expectReject(
      result,
      'not_an_object',
    );
  });

  it('rejects invalid site key', () => {
    const result = parseWire(
      body({
        ...payload,
        s: 'bad-key',
      }),
    );

    expectReject(
      result,
      'bad_site_key',
    );
  });

  it('rejects invalid event name', () => {
    const result = parseWire(
      body({
        ...payload,
        n: 'Page View',
      }),
    );

    expectReject(
      result,
      'bad_event_name',
    );
  });

  it('rejects empty URL', () => {
    const result = parseWire(
      body({
        ...payload,
        u: '',
      }),
    );

    expectReject(
      result,
      'bad_url',
    );
  });

  it('rejects invalid sequence', () => {
    const result = parseWire(
      body({
        ...payload,
        q: 0,
      }),
    );

    expectReject(
      result,
      'bad_seq',
    );
  });

  it('rejects invalid timestamp', () => {
    const result = parseWire(
      body({
        ...payload,
        t: 0,
      }),
    );

    expectReject(
      result,
      'bad_timestamp',
    );
  });

  it('rejects invalid optional fields', () => {
    const cases = [
      ['v', 'bad_version'],
      ['r', 'bad_referrer'],
      ['e', 'bad_engagement'],
      ['rt', 'bad_route'],
      ['w', 'bad_width'],
      ['i', 'bad_insert_id'],
      ['x', 'bad_sent_at'],
      ['f', 'bad_flags'],
    ] as const;

    for (
      const [field, expected] of cases
    ) {
      const value = {
        ...payload,
        [field]:
          field === 'r' ||
          field === 'rt' ||
          field === 'i'
            ? 123
            : -1,
      };

      const result =
        parseWire(body(value));

      expectReject(
        result,
        expected,
      );
    }
  });

  it('rejects invalid props', () => {
    const result = parseWire(
      body({
        ...payload,
        p: 'invalid',
      }),
    );

    expectReject(
      result,
      'bad_props',
    );
  });
});

describe('checkWire', () => {
  it('accepts valid event', () => {
    const parsed =
      parseWire(body());

    expect(parsed.ok).toBe(true);

    if (!parsed.ok) {
      return;
    }

    const result = checkWire(
      headers({
        'user-agent':
          'Mozilla/5.0 Chrome/154.0',
      }),
      parsed,
      edge,
    );

    expect(result.kind).toBe(
      'accept',
    );

    if (
      result.kind === 'accept'
    ) {
      expect(result.status).toBe(204);

      expect(
        result.event.siteId,
      ).toBe(123);

      expect(
        result.event.name,
      ).toBe('pageview');

      expect(
        result.event.host,
      ).toBe('example.com');

      expect(
        result.event.path,
      ).toBe('/products');

      expect(
        result.event.country,
      ).toBe('PK');

      expect(
        result.event.asn,
      ).toBe(12345);
    }
  });

  it('drops unknown site without exposing site id', () => {
    const result = validate(
      headers({
        'user-agent':
          'Mozilla/5.0 Chrome/154.0',
      }),
      body(),
      {
        ...edge,
        site: null,
      },
    );

    expect(result).toMatchObject({
      kind: 'drop',
      status: 204,
      reason: 'not_found',
      headers: {
        'x-tw-dropped':
          'not_found',
      },
    });

    if (
      result.kind === 'drop'
    ) {
      expect(
        result.siteId,
      ).toBeUndefined();
    }
  });

  it('drops inactive site', () => {
    const result = validate(
      headers({
        'user-agent':
          'Mozilla/5.0 Chrome/154.0',
      }),
      body(),
      {
        ...edge,
        site: {
          ...site,
          live: false,
        },
      },
    );

    expect(result.kind).toBe(
      'drop',
    );

    if (
      result.kind === 'drop'
    ) {
      expect(
        result.reason,
      ).toBe('not_found');

      expect(
        result.siteId,
      ).toBeUndefined();
    }
  });

  it('drops mismatched site key', () => {
    const result = validate(
      headers({
        'user-agent':
          'Mozilla/5.0 Chrome/154.0',
      }),
      body({
        ...payload,
        s: 'tw_pub_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }),
      edge,
    );

    expect(result.kind).toBe(
      'drop',
    );

    if (
      result.kind === 'drop'
    ) {
      expect(
        result.reason,
      ).toBe('not_found');
    }
  });

  it('rejects malformed URL', () => {
    const result = validate(
      headers({
        'user-agent':
          'Mozilla/5.0 Chrome/154.0',
      }),
      body({
        ...payload,
        u: 'not-a-url',
      }),
      edge,
    );

    expect(result).toEqual({
      kind: 'reject',
      status: 400,
      reason: 'malformed',
      error: 'bad_url',
    });
  });

  it('drops disallowed hostname', () => {
    const result = validate(
      headers({
        'user-agent':
          'Mozilla/5.0 Chrome/154.0',
      }),
      body({
        ...payload,
        u: 'https://evil.example.net/page',
      }),
      edge,
    );

    expect(result.kind).toBe(
      'drop',
    );

    if (
      result.kind === 'drop'
    ) {
      expect(
        result.reason,
      ).toBe('hostname');

      expect(
        result.siteId,
      ).toBe(123);

      expect(
        result.status,
      ).toBe(204);
    }
  });

  it('allows wildcard hostname', () => {
    const result = validate(
      headers({
        'user-agent':
          'Mozilla/5.0 Chrome/154.0',
      }),
      body({
        ...payload,
        u: 'https://shop.example.com/products',
      }),
      edge,
    );

    expect(result.kind).toBe(
      'accept',
    );

    if (
      result.kind === 'accept'
    ) {
      expect(
        result.event.host,
      ).toBe(
        'shop.example.com',
      );
    }
  });

  it('drops GPC requests', () => {
    const result = validate(
      headers({
        'sec-gpc': '1',
        'user-agent':
          'Mozilla/5.0 Chrome/154.0',
      }),
      body(),
      edge,
    );

    expect(result).toMatchObject({
      kind: 'drop',
      status: 204,
      reason: 'gpc',
      headers: {
        'x-tw-dropped': 'gpc',
      },
    });
  });

  it('drops missing user agent', () => {
    const result = validate(
      headers(),
      body(),
      edge,
    );

    expect(result.kind).toBe(
      'drop',
    );

    if (
      result.kind === 'drop'
    ) {
      expect(
        result.reason,
      ).toBe('bot');

      expect(
        result.detail,
      ).toBe(
        'missing_user_agent',
      );
    }
  });

  it('drops verification agent', () => {
    const result = validate(
      headers({
        'user-agent':
          'TailwatchVerifier/1.0',
      }),
      body(),
      edge,
    );

    expect(result.kind).toBe(
      'drop',
    );

    if (
      result.kind === 'drop'
    ) {
      expect(
        result.reason,
      ).toBe(
        'verification_agent',
      );
    }
  });

  it('drops scripting clients', () => {
    const result = validate(
      headers({
        'user-agent':
          'curl/8.10.1',
      }),
      body(),
      edge,
    );

    expect(result.kind).toBe(
      'drop',
    );

    if (
      result.kind === 'drop'
    ) {
      expect(
        result.reason,
      ).toBe('bot');
    }
  });

  it('drops datacentre ASN', () => {
    const result = validate(
      headers({
        'user-agent':
          'Mozilla/5.0 Chrome/154.0',
      }),
      body(),
      {
        ...edge,
        asn: 16509,
      },
    );

    expect(result.kind).toBe(
      'drop',
    );

    if (
      result.kind === 'drop'
    ) {
      expect(
        result.reason,
      ).toBe('bot');
    }
  });
});

describe('validated event', () => {
  it('normalizes URL', () => {
    const result = validate(
      headers({
        'user-agent':
          'Mozilla/5.0 Chrome/154.0',
      }),
      body({
        ...payload,
        u: 'https://EXAMPLE.COM/products///?utm_medium=cpc&utm_source=google&utm_random=123#section',
      }),
      edge,
    );

    expect(result.kind).toBe(
      'accept',
    );

    if (
      result.kind === 'accept'
    ) {
      expect(
        result.event.url,
      ).toBe(
        'https://example.com/products?utm_medium=cpc&utm_source=google',
      );

      expect(
        result.event.host,
      ).toBe(
        'example.com',
      );

      expect(
        result.event.path,
      ).toBe('/products');
    }
  });

  it('stores optional fields', () => {
    const result = validate(
      headers({
        'user-agent':
          'Mozilla/5.0 Chrome/154.0',
      }),
      body({
        ...payload,
        r: 'https://google.com/',
        e: 12_000,
        rt: '/products/:id',
        w: 1920,
        i: 'insert-123',
        f: 1,
      }),
      edge,
    );

    expect(result.kind).toBe(
      'accept',
    );

    if (
      result.kind === 'accept'
    ) {
      expect(
        result.event.referrer,
      ).toBe(
        'https://google.com/',
      );

      expect(
        result.event.engagementMs,
      ).toBe(12_000);

      expect(
        result.event.route,
      ).toBe(
        '/products/:id',
      );

      expect(
        result.event.width,
      ).toBe(1920);

      expect(
        result.event.insertId,
      ).toBe(
        'insert-123',
      );

      expect(
        result.event.flags,
      ).toBe(1);
    }
  });

  it('stores unknown fields in extra', () => {
    const result = validate(
      headers({
        'user-agent':
          'Mozilla/5.0 Chrome/154.0',
      }),
      body({
        ...payload,
        future_field:
          'future-value',
        another_field: 123,
      }),
      edge,
    );

    expect(result.kind).toBe(
      'accept',
    );

    if (
      result.kind === 'accept'
    ) {
      expect(
        result.event.extra,
      ).toEqual({
        future_field:
          'future-value',
        another_field: 123,
      });
    }
  });

  it('does not store raw IP', () => {
    const result = validate(
      headers({
        'user-agent':
          'Mozilla/5.0 Chrome/154.0',
      }),
      body(),
      edge,
    );

    expect(result.kind).toBe(
      'accept',
    );

    if (
      result.kind === 'accept'
    ) {
      expect(
        'ip' in result.event,
      ).toBe(false);
    }
  });
});

describe('properties', () => {
  it('accepts valid property types', () => {
    const result = validate(
      headers({
        'user-agent':
          'Mozilla/5.0 Chrome/154.0',
      }),
      body({
        ...payload,
        p: {
          category:
            'electronics',
          price: 99.5,
          featured: true,
        },
      }),
      edge,
    );

    expect(result.kind).toBe(
      'accept',
    );

    if (
      result.kind === 'accept'
    ) {
      expect(
        result.event.props,
      ).toEqual({
        category:
          'electronics',
        price: 99.5,
        featured: true,
      });
    }
  });

  it('drops invalid property types individually', () => {
    const result = validate(
      headers({
        'user-agent':
          'Mozilla/5.0 Chrome/154.0',
      }),
      body({
        ...payload,
        p: {
          valid: 'yes',
          invalidObject: {
            nested: true,
          },
          invalidArray: [
            1,
            2,
            3,
          ],
        },
      }),
      edge,
    );

    expect(result.kind).toBe(
      'accept',
    );

    if (
      result.kind === 'accept'
    ) {
      expect(
        result.event.props,
      ).toEqual({
        valid: 'yes',
      });

      expect(
        result.event.warnings.some(
          (warning) =>
            warning.startsWith(
              'prop_type_invalid:',
            ),
        ),
      ).toBe(true);
    }
  });

  it('drops unsafe property keys', () => {
    const result = validate(
      headers({
        'user-agent':
          'Mozilla/5.0 Chrome/154.0',
      }),
      body({
        ...payload,
        p: {
          safe: 'yes',
          __proto__: 'bad',
          constructor: 'bad',
          prototype: 'bad',
        },
      }),
      edge,
    );

    expect(result.kind).toBe(
      'accept',
    );

    if (
      result.kind === 'accept'
    ) {
      expect(
        result.event.props.safe,
      ).toBe('yes');

      expect(
        result.event.props,
      ).not.toHaveProperty(
        '__proto__',
      );

      expect(
        result.event.props,
      ).not.toHaveProperty(
        'constructor',
      );

      expect(
        result.event.props,
      ).not.toHaveProperty(
        'prototype',
      );
    }
  });

  it('limits properties', () => {
    const props: Record<
      string,
      string
    > = {};

    for (
      let index = 0;
      index < 30;
      index++
    ) {
      props[`key_${index}`] =
        `value_${index}`;
    }

    const result = validate(
      headers({
        'user-agent':
          'Mozilla/5.0 Chrome/154.0',
      }),
      body({
        ...payload,
        p: props,
      }),
      edge,
    );

    expect(result.kind).toBe(
      'accept',
    );

    if (
      result.kind === 'accept'
    ) {
      expect(
        Object.keys(
          result.event.props,
        ),
      ).toHaveLength(25);

      expect(
        result.event.warnings.some(
          (warning) =>
            warning.startsWith(
              'props_truncated:',
            ),
        ),
      ).toBe(true);
    }
  });

  it('refuses SSN-shaped values', () => {
    const result = validate(
      headers({
        'user-agent':
          'Mozilla/5.0 Chrome/154.0',
      }),
      body({
        ...payload,
        p: {
          safe: 'hello',
          ssn: '123-45-6789',
        },
      }),
      edge,
    );

    expect(result.kind).toBe(
      'accept',
    );

    if (
      result.kind === 'accept'
    ) {
      expect(
        result.event.props,
      ).toEqual({
        safe: 'hello',
      });

      expect(
        result.event.warnings.some(
          (warning) =>
            warning.startsWith(
              'sensitive_prop_refused:',
            ),
        ),
      ).toBe(true);
    }
  });

  it('refuses card-shaped values', () => {
    const result = validate(
      headers({
        'user-agent':
          'Mozilla/5.0 Chrome/154.0',
      }),
      body({
        ...payload,
        p: {
          card:
            '4111 1111 1111 1111',
          safe: 'hello',
        },
      }),
      edge,
    );

    expect(result.kind).toBe(
      'accept',
    );

    if (
      result.kind === 'accept'
    ) {
      expect(
        result.event.props.card,
      ).toBeUndefined();

      expect(
        result.event.props.safe,
      ).toBe('hello');
    }
  });
});

describe('timestamps', () => {
  it('uses created timestamp when x is absent', () => {
    const timestamp =
      edge.receivedAt - 1000;

    const result = validate(
      headers({
        'user-agent':
          'Mozilla/5.0 Chrome/154.0',
      }),
      body({
        ...payload,
        t: timestamp,
      }),
      edge,
    );

    expect(result.kind).toBe(
      'accept',
    );

    if (
      result.kind === 'accept'
    ) {
      expect(
        result.event.occurredAt,
      ).toBe(timestamp);
    }
  });

  it('uses x for clock skew correction', () => {
    const createdAt =
      edge.receivedAt - 5000;

    const sentAt =
      edge.receivedAt - 2000;

    const result = validate(
      headers({
        'user-agent':
          'Mozilla/5.0 Chrome/154.0',
      }),
      body({
        ...payload,
        t: createdAt,
        x: sentAt,
      }),
      edge,
    );

    expect(result.kind).toBe(
      'accept',
    );

    if (
      result.kind === 'accept'
    ) {
      expect(
        result.event.occurredAt,
      ).toBe(
        edge.receivedAt -
          (sentAt -
            createdAt),
      );
    }
  });

  it('accepts old timestamps as backfill without rewriting them', () => {
    const oldTimestamp =
      edge.receivedAt -
      426 *
        24 *
        60 *
        60 *
        1000;

    const result = validate(
      headers({
        'user-agent':
          'Mozilla/5.0 Chrome/154.0',
      }),
      body({
        ...payload,
        t: oldTimestamp,
      }),
      edge,
    );

    expect(result.kind).toBe(
      'accept',
    );

    if (
      result.kind === 'accept'
    ) {
      expect(
        result.event.occurredAt,
      ).toBe(oldTimestamp);

      expect(
        result.event.backfill,
      ).toBe(true);

      expect(
        result.event.warnings,
      ).not.toContain(
        'timestamp_repaired_old',
      );
    }
  });

  it('requires tracker version on every wire hit', () => {
    const { v: _version, ...withoutVersion } = payload;
    const result = validate(
      headers({
        'user-agent':
          'Mozilla/5.0 Chrome/154.0',
      }),
      body(withoutVersion),
      edge,
    );

    expect(result.kind).toBe('reject');
    if (result.kind === 'reject') {
      expect(result.status).toBe(400);
      expect(result.error).toBe('bad_version');
    }
  });

  it('repairs future timestamps', () => {
    const futureTimestamp =
      edge.receivedAt +
      6 * 60 * 1000;

    const result = validate(
      headers({
        'user-agent':
          'Mozilla/5.0 Chrome/154.0',
      }),
      body({
        ...payload,
        t: futureTimestamp,
      }),
      edge,
    );

    expect(result.kind).toBe(
      'accept',
    );

    if (
      result.kind === 'accept'
    ) {
      expect(
        result.event.occurredAt,
      ).toBe(edge.receivedAt);

      expect(
        result.event.warnings,
      ).toContain(
        'timestamp_repaired_future',
      );
    }
  });

  it('marks backfill events', () => {
    const timestamp =
      edge.receivedAt -
      73 *
        60 *
        60 *
        1000;

    const result = validate(
      headers({
        'user-agent':
          'Mozilla/5.0 Chrome/154.0',
      }),
      body({
        ...payload,
        t: timestamp,
      }),
      edge,
    );

    expect(result.kind).toBe(
      'accept',
    );

    if (
      result.kind === 'accept'
    ) {
      expect(
        result.event.backfill,
      ).toBe(true);
    }
  });
});