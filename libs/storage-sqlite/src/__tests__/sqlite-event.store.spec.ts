import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { SqliteEventStore } from '../sqlite-event.store';

function tmpDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-event-'));
  return path.join(dir, 'test.sqlite');
}

function cleanup(dbPath: string): void {
  try {
    const dir = path.dirname(dbPath);
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

describe('SqliteEventStore', () => {
  let store: SqliteEventStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDbPath();
    store = new SqliteEventStore({
      path: dbPath,
      ttlCleanupIntervalMs: 0,
      maxEvents: 100,
      ttlMs: 300000,
    });
  });

  afterEach(() => {
    store.close();
    cleanup(dbPath);
  });

  describe('storeEvent', () => {
    it('should store an event and return an event ID', async () => {
      const message = { jsonrpc: '2.0', method: 'test', params: {} };
      const id = await store.storeEvent('stream-1', message);

      expect(id).toBe('stream-1:1');
    });

    it('should increment event IDs per stream', async () => {
      const msg = { jsonrpc: '2.0', method: 'test' };
      const id1 = await store.storeEvent('stream-1', msg);
      const id2 = await store.storeEvent('stream-1', msg);
      const id3 = await store.storeEvent('stream-2', msg);

      expect(id1).toBe('stream-1:1');
      expect(id2).toBe('stream-1:2');
      expect(id3).toBe('stream-2:1');
    });

    it('should track event count', async () => {
      const msg = { jsonrpc: '2.0', method: 'test' };
      await store.storeEvent('stream-1', msg);
      await store.storeEvent('stream-1', msg);

      expect(store.size).toBe(2);
    });
  });

  describe('replayEventsAfter', () => {
    it('should replay events after a given event ID', async () => {
      const msg1 = { jsonrpc: '2.0', id: 1, method: 'test1' };
      const msg2 = { jsonrpc: '2.0', id: 2, method: 'test2' };
      const msg3 = { jsonrpc: '2.0', id: 3, method: 'test3' };

      const id1 = await store.storeEvent('stream-1', msg1);
      await store.storeEvent('stream-1', msg2);
      await store.storeEvent('stream-1', msg3);

      const replayed: Array<{ id: string; message: unknown }> = [];

      const streamId = await store.replayEventsAfter(id1, {
        send: async (eventId, message) => {
          replayed.push({ id: eventId, message });
        },
      });

      expect(streamId).toBe('stream-1');
      expect(replayed.length).toBe(2);
      expect(replayed[0].message).toEqual(msg2);
      expect(replayed[1].message).toEqual(msg3);
    });

    it('should return default stream for unknown event ID', async () => {
      const streamId = await store.replayEventsAfter('unknown-id', {
        send: async () => {
          // should not be called
        },
      });

      expect(streamId).toBe('default-stream');
    });

    it('should not replay expired events', async () => {
      // Create store with very short TTL
      store.close();
      cleanup(dbPath);
      dbPath = tmpDbPath();
      store = new SqliteEventStore({
        path: dbPath,
        ttlCleanupIntervalMs: 0,
        ttlMs: 1, // 1ms TTL
      });

      const msg = { jsonrpc: '2.0', method: 'test' };
      const id1 = await store.storeEvent('stream-1', msg);
      await store.storeEvent('stream-1', msg);

      // Wait for events to expire
      await new Promise((r) => setTimeout(r, 10));

      const replayed: unknown[] = [];
      await store.replayEventsAfter(id1, {
        send: async (_id, message) => {
          replayed.push(message);
        },
      });

      expect(replayed.length).toBe(0);
    });
  });

  describe('max events eviction', () => {
    it('should evict oldest events when exceeding max', async () => {
      store.close();
      cleanup(dbPath);
      dbPath = tmpDbPath();
      store = new SqliteEventStore({
        path: dbPath,
        ttlCleanupIntervalMs: 0,
        maxEvents: 3,
        ttlMs: 300000,
      });

      const msg = { jsonrpc: '2.0', method: 'test' };
      await store.storeEvent('stream-1', msg);
      await store.storeEvent('stream-1', msg);
      await store.storeEvent('stream-1', msg);
      await store.storeEvent('stream-1', msg); // This should trigger eviction

      expect(store.size).toBeLessThanOrEqual(3);
    });
  });
});
