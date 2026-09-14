/**
 * RedisEventStore — event-id parsing (GHSA-84j6-jc92-77jm).
 *
 * This is the store auto-enabled, without operator action, in distributed+Redis
 * deployments, and it had no direct unit coverage at all. `parseEventId` splits
 * a client-supplied `Last-Event-ID` and the stream half is concatenated straight
 * into a Redis key, so its validation is the load-bearing part.
 */
import { RedisEventStore } from '../redis.event-store';

/** `parseEventId` is private; exercised through the instance. */
function parse(store: RedisEventStore, eventId: string): [string, string] | undefined {
  return (store as unknown as { parseEventId(id: string): [string, string] | undefined }).parseEventId(eventId);
}

describe('RedisEventStore.parseEventId', () => {
  let store: RedisEventStore;

  beforeEach(() => {
    store = new RedisEventStore({ provider: 'redis', host: 'localhost' } as never);
  });

  it('splits a well-formed id into stream and entry', () => {
    expect(parse(store, 'my-stream:1234567890123-0')).toEqual(['my-stream', '1234567890123-0']);
  });

  it('handles a stream id that itself contains dashes and colons', () => {
    expect(parse(store, 'session-a _GET_stream:1700000000000-3')).toEqual(['session-a _GET_stream', '1700000000000-3']);
  });

  it('accepts a bare millisecond entry id', () => {
    expect(parse(store, 'stream:1700000000000')).toEqual(['stream', '1700000000000']);
  });

  it('rejects an id with no separator', () => {
    expect(parse(store, 'no-separator')).toBeUndefined();
  });

  it('rejects an entry id that is not a Redis stream id', () => {
    expect(parse(store, 'stream:not-an-id')).toBeUndefined();
    expect(parse(store, 'stream:')).toBeUndefined();
  });

  it('rejects an empty stream id', () => {
    expect(parse(store, ':1700000000000-0')).toBeUndefined();
  });

  it('round-trips any stream id storeEvent would accept', () => {
    // `storeEvent` takes any `StreamId` and uses it as an exact Redis key —
    // Redis applies no glob matching to a key argument, and ioredis
    // length-prefixes it. Rejecting characters here would let `storeEvent` mint
    // ids that `parseEventId` then refuses, silently breaking replay for that
    // stream. Ownership is enforced by the session-scoped facade instead.
    for (const streamId of ['tenant?1', 'a*b', 'str[eam', 'plain', 'session-a _GET_stream']) {
      expect(parse(store, `${streamId}:1700000000000-0`)).toEqual([streamId, '1700000000000-0']);
    }
  });
});

describe('RedisEventStore.replayEventsAfter', () => {
  it('replays nothing for an unparseable event id, without touching Redis', async () => {
    const store = new RedisEventStore({ provider: 'redis', host: 'localhost' } as never);
    // getClient would throw if it were reached — no Redis is running here.
    const send = jest.fn(async () => undefined);

    const streamId = await store.replayEventsAfter('garbage' as never, { send } as never);

    expect(send).not.toHaveBeenCalled();
    expect(String(streamId)).toBe('default-stream');
  });
});
