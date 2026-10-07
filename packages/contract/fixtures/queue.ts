import { deriveVisitorHashes, validate } from '../src';
import type { EventQueueMessage, HeaderReader, ValidatedEvent } from '../src';
import {
  BROWSER_UA,
  FIXTURE_IP,
  FIXTURE_RECEIVED_AT,
  FIXTURE_SITE,
  SITE,
  acceptedFixtures,
  fixtureBody,
  fixtureHeaders,
} from './payloads';
import { sessionEvents } from './sessions';

/**
 * Queue-message fixtures (Stage 1 artefact, used from Stage 3 on).
 *
 * BUILD-ORDER Stage 3: "push fixtures straight into the queue, bypassing the collector".
 * A queue message is the collector's OUTPUT, so these are produced by running the wire fixtures
 * through the same contract functions the collector uses (validate + visitor hashes). Nothing is
 * hand-copied, so the two shapes cannot drift apart.
 */

const headerReader = (headers: Record<string, string>): HeaderReader => ({
  get: (name) => headers[name.toLowerCase()] ?? null,
});

function mustAccept(name: string, outcome: ReturnType<typeof validate>): ValidatedEvent {
  if (outcome.kind !== 'accept') throw new Error(`fixture ${name} is not accepted (${outcome.kind})`);
  return outcome.event;
}

/** Every accepted wire fixture as the queue message the collector would send. */
export async function wireQueueMessages(): Promise<{ name: string; message: EventQueueMessage }[]> {
  const out: { name: string; message: EventQueueMessage }[] = [];
  for (const fixture of acceptedFixtures()) {
    const headers = fixtureHeaders(fixture);
    const event = mustAccept(
      fixture.name,
      validate(headerReader(headers), fixtureBody(fixture), {
        receivedAt: FIXTURE_RECEIVED_AT,
        site: FIXTURE_SITE,
        asn: fixture.asn,
      }),
    );
    const visitor = await deriveVisitorHashes(
      FIXTURE_SITE.identitySecret!,
      FIXTURE_RECEIVED_AT,
      FIXTURE_IP,
      headers['user-agent'] ?? '',
      String(FIXTURE_SITE.id),
    );
    out.push({ name: fixture.name, message: { v: 1, type: 'event', event, visitor } });
  }
  return out;
}

/**
 * The session fixture (fixtures/sessions.ts, visitors A..I) as queue messages.
 * Visitor hashes are fixed UInt64 strings so expected ClickHouse rows are easy to read:
 * visitor A -> today 1001 / yesterday 2001, B -> 1002 / 2002, ...
 * Expected result: sessionExpected (11 sessions, 5 engaged, 15 pageviews, 9 visitors).
 */
export function sessionQueueMessages(): EventQueueMessage[] {
  const letters = [...new Set(sessionEvents.map((e) => e.visitor))].sort();
  return sessionEvents.map((e, index) => {
    const n = letters.indexOf(e.visitor) + 1;
    const body = JSON.stringify({
      s: SITE,
      n: e.name,
      u: `https://example.com/${e.visitor.toLowerCase()}/${index}`,
      q: index + 1,
      t: e.t,
      v: 1,
      i: `sess-${index}`,
      ...(e.engagementMs !== undefined ? { e: e.engagementMs } : {}),
      ...(e.utm ? { u: `https://example.com/${e.visitor.toLowerCase()}/${index}?utm_source=${e.utm}` } : {}),
    });
    const event = mustAccept(
      `session_${index}`,
      validate(headerReader({ 'user-agent': BROWSER_UA }), body, { receivedAt: e.t, site: FIXTURE_SITE }),
    );
    return { v: 1, type: 'event', event, visitor: { hash: String(1000 + n), prevHash: String(2000 + n) } };
  });
}
