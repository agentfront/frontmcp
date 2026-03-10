import { MemoryEventStore } from '../memory.event-store';
import type { StreamId, EventId } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

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
