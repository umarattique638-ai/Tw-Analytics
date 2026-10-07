import { describe, expect, it } from 'vitest';
import { SITE_KEY_RE, validate } from '../src';
import type { HeaderReader } from '../src';
import {
  FIXTURE_RECEIVED_AT,
  FIXTURE_SITE,
  OTHER_SITE,
  SITE,
  acceptedFixtures,
  contractFixtures,
  droppedFixtures,
  fixtureBody,
  fixtureHeaders,
  rejectedFixtures,
} from '../fixtures/payloads';
import type { ContractFixture } from '../fixtures/payloads';
import { sessionQueueMessages, wireQueueMessages } from '../fixtures/queue';
import { sessionExpected } from '../fixtures/sessions';

const reader = (h: Record<string, string>): HeaderReader => ({ get: (n) => h[n.toLowerCase()] ?? null });

function runFixture(fixture: ContractFixture) {
  return validate(reader(fixtureHeaders(fixture)), fixtureBody(fixture), {
    receivedAt: FIXTURE_RECEIVED_AT,
    site: FIXTURE_SITE,
    asn: fixture.asn,
  });
}

describe('Stage 1 fixture corpus: shape', () => {
  it('has exactly 50 fixtures with unique names', () => {
    expect(contractFixtures).toHaveLength(50);
    expect(new Set(contractFixtures.map((f) => f.name)).size).toBe(50);
  });

  it('covers every outcome class', () => {
    expect(acceptedFixtures().length).toBe(22);
    expect(droppedFixtures().length).toBe(9);
    expect(rejectedFixtures().length).toBe(19);
    expect(new Set(droppedFixtures().map((f) => (f.expect as { reason: string }).reason))).toEqual(
      new Set(['not_found', 'hostname', 'gpc', 'bot', 'verification_agent']),
    );
    expect(rejectedFixtures().some((f) => f.expect.kind === 'reject' && f.expect.status === 413)).toBe(true);
  });

  it('uses well-formed site keys for the known and the unknown site', () => {
    expect(SITE_KEY_RE.test(SITE)).toBe(true);
    expect(SITE_KEY_RE.test(OTHER_SITE)).toBe(true);
  });

  it('the proto fixture really carries a __proto__ key (an object literal would not)', () => {
    const fixture = contractFixtures.find((f) => f.name === 'proto_prop_key_ignored')!;
    expect(fixtureBody(fixture)).toContain('"__proto__"');
  });
});

describe('Stage 1 fixture corpus: every fixture produces exactly its frozen outcome', () => {
  for (const fixture of contractFixtures) {
    it(fixture.name, () => {
      const outcome = runFixture(fixture);
      const want = fixture.expect;

      expect(outcome.kind).toBe(want.kind);

      if (want.kind === 'accept' && outcome.kind === 'accept') {
        expect(outcome.status).toBe(204);
        expect(outcome.event.warnings).toEqual(want.warnings ?? []);
        if (want.event) expect(outcome.event).toMatchObject(want.event);
      }
      if (want.kind === 'drop' && outcome.kind === 'drop') {
        expect(outcome.status).toBe(204);
        expect(outcome.reason).toBe(want.reason);
      }
      if (want.kind === 'reject' && outcome.kind === 'reject') {
        expect(outcome.status).toBe(want.status);
        expect(outcome.error).toBe(want.error);
      }
    });
  }
});

describe('queue-message fixtures (input for Stage 3)', () => {
  it('turns every accepted wire fixture into a v1 event message without the IP', async () => {
    const messages = await wireQueueMessages();
    expect(messages).toHaveLength(acceptedFixtures().length);
    for (const { message } of messages) {
      expect(message.v).toBe(1);
      expect(message.type).toBe('event');
      expect(message.visitor.hash).toMatch(/^\d+$/);
      expect(message.visitor.prevHash).toMatch(/^\d+$/);
      expect(JSON.stringify(message)).not.toContain('203.0.113.7');
    }
  });

  it('is deterministic (same input, same hashes), so Stage 3 can assert exact rows', async () => {
    expect(await wireQueueMessages()).toEqual(await wireQueueMessages());
  });

  it('the session fixture becomes one message per event, all accepted', () => {
    const messages = sessionQueueMessages();
    expect(messages).toHaveLength(18);
    expect(new Set(messages.map((m) => m.visitor.hash)).size).toBe(sessionExpected.uniqueVisitors);
  });
});
