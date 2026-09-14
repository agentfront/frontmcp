import { type EventId, type JSONRPCMessage, type StreamId } from '@frontmcp/protocol';

import { MemoryEventStore } from '../memory.event-store';

describe('MemoryEventStore', () => {
  describe('storeEvent', () => {
    it('should store events and return unique event IDs', async () => {
      const store = new MemoryEventStore();
      const streamId = 'test-stream' as StreamId;
      const message: JSONRPCMessage = { jsonrpc: '2.0', method: 'test', id: 1 };

      const id1 = await store.storeEvent(streamId, message);
      const id2 = await store.storeEvent(streamId, message);

      expect(id1).toBe('test-stream:1');
      expect(id2).toBe('test-stream:2');
    });

    it('should track store size', async () => {
      const store = new MemoryEventStore();
      const streamId = 'test-stream' as StreamId;
      const message: JSONRPCMessage = { jsonrpc: '2.0', method: 'test', id: 1 };

      expect(store.size).toBe(0);

      await store.storeEvent(streamId, message);
      expect(store.size).toBe(1);

      await store.storeEvent(streamId, message);
      expect(store.size).toBe(2);
    });

    it('should evict oldest events when maxEvents is exceeded', async () => {
      const store = new MemoryEventStore({ maxEvents: 3 });
      const streamId = 'test-stream' as StreamId;

      // Store 4 events with max 3
      for (let i = 1; i <= 4; i++) {
        const message: JSONRPCMessage = { jsonrpc: '2.0', method: `test-${i}`, id: i };
        await store.storeEvent(streamId, message);
      }

      // Should have evicted oldest, keeping only 3
      expect(store.size).toBe(3);
    });
  });

  describe('replayEventsAfter', () => {
    it('should replay events after a given event ID', async () => {
      const store = new MemoryEventStore();
      const streamId = 'test-stream' as StreamId;
      const messages: JSONRPCMessage[] = [
        { jsonrpc: '2.0', method: 'msg1', id: 1 },
        { jsonrpc: '2.0', method: 'msg2', id: 2 },
        { jsonrpc: '2.0', method: 'msg3', id: 3 },
      ];

      const eventIds: EventId[] = [];
      for (const msg of messages) {
        const id = await store.storeEvent(streamId, msg);
        eventIds.push(id);
      }

      // Replay after first event
      const replayed: JSONRPCMessage[] = [];
      const resultStreamId = await store.replayEventsAfter(eventIds[0], {
        send: async (_id, msg) => {
          replayed.push(msg);
        },
      });

      expect(resultStreamId).toBe(streamId);
      expect(replayed).toHaveLength(2);
      expect(replayed[0]).toEqual(messages[1]);
      expect(replayed[1]).toEqual(messages[2]);
    });

    it('should return default stream when event ID is unknown', async () => {
      const store = new MemoryEventStore();
      const unknownId = 'unknown:1' as EventId;

      const replayed: JSONRPCMessage[] = [];
      const resultStreamId = await store.replayEventsAfter(unknownId, {
        send: async (_id, msg) => {
          replayed.push(msg);
        },
      });

      expect(resultStreamId).toBe('default-stream');
      expect(replayed).toHaveLength(0);
    });

    it('should not replay expired events', async () => {
      // Use very short TTL for testing
      const store = new MemoryEventStore({ ttlMs: 10 });
      const streamId = 'test-stream' as StreamId;
      const message: JSONRPCMessage = { jsonrpc: '2.0', method: 'test', id: 1 };

      const eventId = await store.storeEvent(streamId, message);

      // Store another event for replay reference
      const message2: JSONRPCMessage = { jsonrpc: '2.0', method: 'test2', id: 2 };
      await store.storeEvent(streamId, message2);

      // Wait for TTL to expire
      await new Promise((r) => setTimeout(r, 20));

      // Replay - should get nothing because events are expired
      const replayed: JSONRPCMessage[] = [];
      await store.replayEventsAfter(eventId, {
        send: async (_id, msg) => {
          replayed.push(msg);
        },
      });

      // Second event should be expired too
      expect(replayed).toHaveLength(0);
    });
  });

  describe('clear', () => {
    it('should clear all stored events', async () => {
      const store = new MemoryEventStore();
      const streamId = 'test-stream' as StreamId;
      const message: JSONRPCMessage = { jsonrpc: '2.0', method: 'test', id: 1 };

      await store.storeEvent(streamId, message);
      await store.storeEvent(streamId, message);
      expect(store.size).toBe(2);

      store.clear();
      expect(store.size).toBe(0);
    });
  });
});

/**
 * GHSA-84j6-jc92-77jm — the store replays whatever stream the caller's
 * `Last-Event-ID` names, with no notion of who is asking.
 *
 * Every test above this point uses a single stream, so nothing covered what
 * happens when two sessions share the store — which is always, since one
 * instance backs every session on a scope.
 */
describe('MemoryEventStore — cross-session replay (GHSA-84j6-jc92-77jm)', () => {
  it('replays another stream in full when handed its event id', async () => {
    const store = new MemoryEventStore();

    const victimFirst = await store.storeEvent(
      'victim-stream' as StreamId,
      {
        jsonrpc: '2.0',
        id: 1,
        result: { secret: 'VICTIM-1' },
      } as JSONRPCMessage,
    );
    await store.storeEvent(
      'victim-stream' as StreamId,
      {
        jsonrpc: '2.0',
        id: 2,
        result: { secret: 'VICTIM-ONLY' },
      } as JSONRPCMessage,
    );

    const received: JSONRPCMessage[] = [];
    // An unrelated session presenting the victim's event id.
    await store.replayEventsAfter(victimFirst, {
      send: async (_id, msg) => {
        received.push(msg);
      },
    });

    // Documents the raw store's behaviour: it has no caller identity to check
    // against, which is why ownership is enforced by the session-scoped facade
    // rather than inside the store itself.
    expect(received).toHaveLength(1);
  });

  it('numbers events sequentially, so an id is guessable from the stream name', async () => {
    const store = new MemoryEventStore();

    const first = await store.storeEvent(
      '_GET_stream' as StreamId,
      {
        jsonrpc: '2.0',
        id: 1,
        result: {},
      } as JSONRPCMessage,
    );

    // The upstream transport uses the constant `_GET_stream` for every session's
    // standalone SSE stream, so this id required no guessing at all.
    expect(String(first)).toBe('_GET_stream:1');
  });
});
