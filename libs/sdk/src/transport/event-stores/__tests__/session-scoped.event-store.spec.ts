/**
 * Session scoping for SSE event replay (GHSA-84j6-jc92-77jm).
 *
 * One `EventStore` instance is shared by every MCP session on a scope, and the
 * upstream `replayEventsAfter(lastEventId, { send })` contract carries no caller
 * identity — so no implementation can check ownership from its arguments alone.
 *
 * The exposure is not theoretical: the upstream transport writes every session's
 * standalone GET/SSE notifications under the hardcoded stream id `_GET_stream`,
 * and `MemoryEventStore` numbers events sequentially. `Last-Event-ID:
 * _GET_stream:1` therefore replays the cross-session backlog with nothing to
 * guess. It is also auto-enabled, without operator action, in distributed+Redis
 * deployments — exactly the multi-tenant topology where it matters.
 *
 * The fix is a per-session facade: the transport already knows its session id
 * when it builds the store, so stream ids are namespaced by it and a replay
 * whose event id belongs to another session replays nothing.
 */
import type { EventId, JSONRPCMessage, StreamId } from '@frontmcp/protocol';

import { MemoryEventStore } from '../memory.event-store';
import { createSessionScopedEventStore } from '../session-scoped.event-store';

const GET_STREAM = '_GET_stream' as StreamId;

function message(id: number, secret: string): JSONRPCMessage {
  return { jsonrpc: '2.0', id, result: { secret } } as JSONRPCMessage;
}

/** Collect everything a replay sends. */
async function replay(
  store: { replayEventsAfter: (id: EventId, o: never) => Promise<StreamId> },
  lastEventId: EventId,
) {
  const received: JSONRPCMessage[] = [];
  const send = async (_id: EventId, msg: JSONRPCMessage): Promise<void> => {
    received.push(msg);
  };
  await store.replayEventsAfter(lastEventId, { send } as never);
  return received;
}

describe('createSessionScopedEventStore', () => {
  let shared: MemoryEventStore;

  beforeEach(() => {
    shared = new MemoryEventStore();
  });

  it('replays a session its own events', async () => {
    const victim = createSessionScopedEventStore(shared, 'victim-session');

    const first = await victim.storeEvent(GET_STREAM, message(1, 'VICTIM-1'));
    await victim.storeEvent(GET_STREAM, message(2, 'VICTIM-2'));

    const received = await replay(victim, first);

    expect(received).toEqual([message(2, 'VICTIM-2')]);
  });

  it('replays NOTHING when another session presents the event id', async () => {
    const victim = createSessionScopedEventStore(shared, 'victim-session');
    const attacker = createSessionScopedEventStore(shared, 'attacker-session');

    const victimEvent = await victim.storeEvent(GET_STREAM, message(1, 'VICTIM-1'));
    await victim.storeEvent(GET_STREAM, message(2, 'VICTIM-ONLY'));

    const received = await replay(attacker, victimEvent);

    expect(received).toEqual([]);
  });

  it('keeps two sessions on the same hardcoded stream id apart', async () => {
    // `_GET_stream` is a constant in the upstream transport — identical for every
    // session — so without scoping both sessions share one event list.
    const a = createSessionScopedEventStore(shared, 'session-a');
    const b = createSessionScopedEventStore(shared, 'session-b');

    const aFirst = await a.storeEvent(GET_STREAM, message(1, 'A-1'));
    await a.storeEvent(GET_STREAM, message(2, 'A-2'));
    await b.storeEvent(GET_STREAM, message(3, 'B-1'));

    expect(await replay(a, aFirst)).toEqual([message(2, 'A-2')]);
  });

  it('replays nothing for a guessed sequential event id from another session', async () => {
    const victim = createSessionScopedEventStore(shared, 'victim-session');
    await victim.storeEvent(GET_STREAM, message(1, 'VICTIM-1'));
    await victim.storeEvent(GET_STREAM, message(2, 'VICTIM-ONLY'));

    const attacker = createSessionScopedEventStore(shared, 'attacker-session');

    // The literal header an attacker would send, built from public knowledge.
    expect(await replay(attacker, '_GET_stream:1' as EventId)).toEqual([]);
  });

  it('returns a stream id the caller owns, even for an unknown event id', async () => {
    // The upstream transport registers the caller's live SSE controller under
    // whatever StreamId comes back, so it must never be another session's.
    const attacker = createSessionScopedEventStore(shared, 'attacker-session');

    const streamId = await attacker.replayEventsAfter('_GET_stream:1' as EventId, {
      send: async () => undefined,
    });

    expect(String(streamId)).toContain('attacker-session');
  });

  it('resolves getStreamIdForEventId only for its own events', async () => {
    // Implementing this re-activates the upstream 409 conflict guard, which was
    // dead code while no store provided the method.
    const victim = createSessionScopedEventStore(shared, 'victim-session');
    const attacker = createSessionScopedEventStore(shared, 'attacker-session');
    const victimEvent = await victim.storeEvent(GET_STREAM, message(1, 'VICTIM-1'));

    expect(await victim.getStreamIdForEventId?.(victimEvent)).toBeDefined();
    expect(await attacker.getStreamIdForEventId?.(victimEvent)).toBeUndefined();
  });

  it('passes through to the shared store, so one store still backs every session', async () => {
    const a = createSessionScopedEventStore(shared, 'session-a');
    const b = createSessionScopedEventStore(shared, 'session-b');

    await a.storeEvent(GET_STREAM, message(1, 'A'));
    await b.storeEvent(GET_STREAM, message(2, 'B'));

    expect(shared.size).toBe(2);
  });
});
