import { batchToken } from '../core/batch';
import type { InboundEvent } from './classify';
import type { InboundMessage, StateSnapshot } from './ports';

/** Earlier insert groups that keep their own insert in one retry (subrequest budget). */
const MAX_OLD_GROUPS = 3;

export interface InsertGroups {
  /** This attempt's group (from the batch's message ids). */
  own: string;
  /** Groups of earlier, unfinished attempts that keep their own insert (and token). */
  old: string[];
  /** The group a de-dup key goes out in. */
  of(key: string): string;
}

/**
 * Insert groups: this attempt's own group, plus the group of anything an earlier attempt was inserting.
 * At most MAX_OLD_GROUPS earlier groups keep their own insert (Free plan: 50 subrequests per invocation);
 * in the very rare case of more, the rest join this attempt's group.
 */
export async function planGroups(messages: readonly InboundMessage[], snapshot: StateSnapshot): Promise<InsertGroups> {
  const own = await batchToken(
    messages.map((m) => m.id),
    'group',
  );
  const old = [...new Set(snapshot.intents?.values() ?? [])].sort().slice(0, MAX_OLD_GROUPS);
  return {
    own,
    old,
    of(key) {
      const g = snapshot.intents?.get(key);
      return g && old.includes(g) ? g : own;
    },
  };
}

/**
 * Sessions need time order per visitor; the queue does not guarantee order. Events an earlier attempt was
 * inserting go FIRST (by group, then time), so their rows come out exactly as the first time and the
 * ClickHouse token can drop them; this attempt's new events then continue from that state.
 */
export function sortEvents(events: InboundEvent[], groups: InsertGroups): void {
  const rank = (key: string) => {
    const g = groups.of(key);
    return g === groups.own ? groups.old.length : groups.old.indexOf(g);
  };
  events.sort(
    (a, b) =>
      rank(a.key) - rank(b.key) || a.msg.event.occurredAt - b.msg.event.occurredAt || a.msg.event.seq - b.msg.event.seq || (a.id < b.id ? -1 : 1),
  );
}

/** Earlier groups first, this attempt's own group last. */
export const insertOrder = <T>(groups: Map<string, T>, own: string): [string, T][] =>
  [...groups.entries()].sort(([a], [b]) => (a === own ? 1 : b === own ? -1 : a < b ? -1 : 1));
