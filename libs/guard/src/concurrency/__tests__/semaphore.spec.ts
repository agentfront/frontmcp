import { DistributedSemaphore } from '../index';
import { QueueTimeoutError } from '../../errors/index';
import type { StorageAdapter } from '@frontmcp/utils';

function createMockStorage(): jest.Mocked<StorageAdapter> {
  const data = new Map<string, string>();

  return {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    ping: jest.fn().mockResolvedValue(true),
    get: jest.fn().mockImplementation(async (key: string) => data.get(key) ?? null),
    set: jest.fn().mockImplementation(async (key: string, value: string) => {
      data.set(key, value);
    }),
    delete: jest.fn().mockImplementation(async (key: string) => data.delete(key)),
    exists: jest.fn().mockImplementation(async (key: string) => data.has(key)),
    mget: jest.fn().mockImplementation(async (keys: string[]) => keys.map((k) => data.get(k) ?? null)),
    mset: jest.fn().mockResolvedValue(undefined),
    mdelete: jest.fn().mockImplementation(async (keys: string[]) => {
      let deleted = 0;
      for (const k of keys) {
        if (data.delete(k)) deleted++;
      }
      return deleted;
    }),
    expire: jest.fn().mockResolvedValue(true),
    ttl: jest.fn().mockResolvedValue(-1),
    keys: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    incr: jest.fn().mockImplementation(async (key: string) => {
      const current = parseInt(data.get(key) ?? '0', 10);
      const next = current + 1;
      data.set(key, String(next));
      return next;
    }),
    decr: jest.fn().mockImplementation(async (key: string) => {
      const current = parseInt(data.get(key) ?? '0', 10);
      const next = current - 1;
      data.set(key, String(next));
      return next;
    }),
    incrBy: jest.fn().mockResolvedValue(0),
    publish: jest.fn().mockResolvedValue(0),
    subscribe: jest.fn().mockResolvedValue(jest.fn()),
    supportsPubSub: jest.fn().mockReturnValue(false),
  } as unknown as jest.Mocked<StorageAdapter>;
}

describe('DistributedSemaphore', () => {
  let storage: jest.Mocked<StorageAdapter>;
  let semaphore: DistributedSemaphore;

  beforeEach(() => {
    storage = createMockStorage();
    semaphore = new DistributedSemaphore(storage, 300);
  });

  describe('acquire', () => {
    it('should acquire a slot when under the limit', async () => {
      const ticket = await semaphore.acquire('test', 3, 0, 'my-tool');

      expect(ticket).not.toBeNull();
      expect(ticket!.ticket).toBeDefined();
      expect(typeof ticket!.release).toBe('function');
    });

    it('should acquire up to maxConcurrent slots', async () => {
      const tickets = [];
      for (let i = 0; i < 3; i++) {
        const ticket = await semaphore.acquire('test', 3, 0, 'my-tool');
        expect(ticket).not.toBeNull();
        tickets.push(ticket!);
      }

      // All 3 tickets should have unique IDs
      const ids = tickets.map((t) => t.ticket);
      expect(new Set(ids).size).toBe(3);
    });

    it('should reject when at maxConcurrent with no queueing', async () => {
      // Fill all 2 slots
      await semaphore.acquire('test', 2, 0, 'my-tool');
      await semaphore.acquire('test', 2, 0, 'my-tool');

      // 3rd should be rejected
      const ticket = await semaphore.acquire('test', 2, 0, 'my-tool');
      expect(ticket).toBeNull();
    });

    it('should store ticket with TTL', async () => {
      await semaphore.acquire('test', 3, 0, 'my-tool');

      expect(storage.set).toHaveBeenCalledWith(expect.stringMatching(/^test:ticket:/), expect.any(String), {
        ttlSeconds: 300,
      });
    });

    it('should increment and decrement count correctly', async () => {
      const countKey = 'test:count';

      // Acquire
      const ticket = await semaphore.acquire('test', 3, 0, 'my-tool');
      expect(storage.incr).toHaveBeenCalledWith(countKey);

      // Release
      await ticket!.release();
      expect(storage.decr).toHaveBeenCalledWith(countKey);
    });
  });

  describe('release', () => {
    it('should release the slot and delete ticket', async () => {
      const ticket = await semaphore.acquire('test', 3, 0, 'my-tool');
      expect(ticket).not.toBeNull();

      await ticket!.release();

      // Should have deleted the ticket key
      expect(storage.delete).toHaveBeenCalledWith(expect.stringContaining(`test:ticket:${ticket!.ticket}`));
    });

    it('should allow new acquisitions after release', async () => {
      // Fill the single slot
      const ticket1 = await semaphore.acquire('test', 1, 0, 'my-tool');
      expect(ticket1).not.toBeNull();

      // Should be rejected
      const ticket2 = await semaphore.acquire('test', 1, 0, 'my-tool');
      expect(ticket2).toBeNull();

      // Release and try again
      await ticket1!.release();
      const ticket3 = await semaphore.acquire('test', 1, 0, 'my-tool');
      expect(ticket3).not.toBeNull();
    });

    it('should reset count to 0 if it goes negative', async () => {
      // Acquire a ticket to get a valid release function
      const ticket = await semaphore.acquire('test', 5, 0, 'my-tool');
      expect(ticket).not.toBeNull();

      // Manually set count to 0 before releasing (simulating a stale state)
      await storage.set('test:count', '0');

      // Release will decr from 0 to -1, triggering the negative count reset
      await ticket!.release();

      // The release should have detected newCount < 0 and reset to '0'
      expect(storage.set).toHaveBeenCalledWith('test:count', '0');

      // Verify count is back to 0, not negative
      const count = await semaphore.getActiveCount('test');
      expect(count).toBe(0);
    });

    it('should publish release notification when pub/sub is supported', async () => {
      storage.supportsPubSub.mockReturnValue(true);

      const ticket = await semaphore.acquire('test', 3, 0, 'my-tool');
      await ticket!.release();

      expect(storage.publish).toHaveBeenCalledWith('test:released', ticket!.ticket);
    });

    it('should not fail if pub/sub publish throws', async () => {
      storage.supportsPubSub.mockReturnValue(true);
      storage.publish.mockRejectedValue(new Error('pub/sub failure'));

      const ticket = await semaphore.acquire('test', 3, 0, 'my-tool');
      // Should not throw
      await expect(ticket!.release()).resolves.not.toThrow();
    });
  });

  describe('queueing', () => {
    it('should throw QueueTimeoutError when queue timeout expires', async () => {
      // Fill the single slot
      await semaphore.acquire('test', 1, 0, 'my-tool');

      // Try to acquire with a very short queue timeout (real timers)
      await expect(semaphore.acquire('test', 1, 150, 'my-tool')).rejects.toThrow(QueueTimeoutError);
    }, 10_000);

    it('should include entity name and timeout in QueueTimeoutError', async () => {
      await semaphore.acquire('test', 1, 0, 'my-tool');

      try {
        await semaphore.acquire('test', 1, 150, 'my-tool');
        fail('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(QueueTimeoutError);
        expect((error as QueueTimeoutError).entityName).toBe('my-tool');
        expect((error as QueueTimeoutError).queueTimeoutMs).toBe(150);
      }
    }, 10_000);

    it('should acquire slot when released during queue wait', async () => {
      // Fill the single slot
      const ticket1 = await semaphore.acquire('test', 1, 0, 'my-tool');
      expect(ticket1).not.toBeNull();

      // Start waiting for slot, release after 50ms
      const acquirePromise = semaphore.acquire('test', 1, 2000, 'my-tool');
      setTimeout(() => ticket1!.release(), 50);

      const ticket2 = await acquirePromise;
      expect(ticket2).not.toBeNull();
    }, 10_000);
  });

  describe('getActiveCount', () => {
    it('should return 0 when no tickets are active', async () => {
      const count = await semaphore.getActiveCount('test');
      expect(count).toBe(0);
    });

    it('should return the correct count of active tickets', async () => {
      await semaphore.acquire('test', 5, 0, 'my-tool');
      await semaphore.acquire('test', 5, 0, 'my-tool');

      const count = await semaphore.getActiveCount('test');
      expect(count).toBe(2);
    });

    it('should decrease after release', async () => {
      const ticket1 = await semaphore.acquire('test', 5, 0, 'my-tool');
      await semaphore.acquire('test', 5, 0, 'my-tool');

      await ticket1!.release();

      const count = await semaphore.getActiveCount('test');
      expect(count).toBe(1);
    });
  });

  describe('forceReset', () => {
    it('should delete the counter and all ticket keys', async () => {
      storage.keys.mockResolvedValue(['test:ticket:a', 'test:ticket:b']);

      await semaphore.forceReset('test');

      expect(storage.delete).toHaveBeenCalledWith('test:count');
      expect(storage.mdelete).toHaveBeenCalledWith(['test:ticket:a', 'test:ticket:b']);
    });

    it('should handle empty ticket list', async () => {
      storage.keys.mockResolvedValue([]);

      await semaphore.forceReset('test');

      expect(storage.delete).toHaveBeenCalledWith('test:count');
      expect(storage.mdelete).not.toHaveBeenCalled();
    });
  });

  describe('waitForSlot with pub/sub', () => {
    it('should use pub/sub subscription to wake up when a slot is released', async () => {
      let subscribeCallback: (() => void) | undefined;
      const mockUnsubscribe = jest.fn().mockResolvedValue(undefined);

      storage.supportsPubSub.mockReturnValue(true);
      storage.subscribe.mockImplementation(async (_channel: string, cb: () => void) => {
        subscribeCallback = cb;
        return mockUnsubscribe;
      });

      // Fill the single slot
      const ticket1 = await semaphore.acquire('test', 1, 0, 'my-tool');
      expect(ticket1).not.toBeNull();

      // Start waiting for a slot with a long queue timeout
      const acquirePromise = semaphore.acquire('test', 1, 3000, 'my-tool');

      // After a short delay, release the slot and notify via pub/sub
      setTimeout(() => {
        ticket1!.release();
        // Notify via pub/sub callback
        if (subscribeCallback) subscribeCallback();
      }, 50);

      const ticket2 = await acquirePromise;
      expect(ticket2).not.toBeNull();

      // Should have subscribed to the released channel
      expect(storage.subscribe).toHaveBeenCalledWith('test:released', expect.any(Function));

      // Cleanup: unsubscribe should have been called
      expect(mockUnsubscribe).toHaveBeenCalled();
    }, 10_000);

    it('should skip sleep and retry immediately when notified flag is set', async () => {
      let subscribeCallback: (() => void) | undefined;
      const mockUnsubscribe = jest.fn().mockResolvedValue(undefined);
      let pollCount = 0;

      storage.supportsPubSub.mockReturnValue(true);
      storage.subscribe.mockImplementation(async (_channel: string, cb: () => void) => {
        subscribeCallback = cb;
        return mockUnsubscribe;
      });

      // Fill the single slot
      const ticket1 = await semaphore.acquire('notify-test', 1, 0, 'my-tool');
      expect(ticket1).not.toBeNull();

      // Override incr so that on poll attempts for the waitForSlot key,
      // we trigger the notification callback between poll iterations.
      // The first poll inside waitForSlot will fail (slot full).
      // We set notified=true via callback so the next iteration skips sleep.
      // Then we release the slot so the subsequent tryAcquire succeeds.
      const originalIncr = storage.incr.getMockImplementation()!;
      storage.incr.mockImplementation(async (key: string) => {
        if (key === 'notify-test:count') {
          pollCount++;
          if (pollCount === 3) {
            // This is the second poll attempt in waitForSlot (pollCount 2 was the first
            // waitForSlot tryAcquire, pollCount 3 is after notification).
            // By now the notified flag has triggered `continue`, skipping sleep.
            // Release the actual slot so this tryAcquire succeeds.
            await storage.set('notify-test:count', '0');
            return 1;
          }
          if (pollCount === 2) {
            // First poll attempt in waitForSlot fails. Set notified before sleep.
            const result = await originalIncr(key);
            // Trigger the pub/sub notification synchronously
            if (subscribeCallback) subscribeCallback();
            return result;
          }
        }
        return originalIncr(key);
      });

      const acquirePromise = semaphore.acquire('notify-test', 1, 5000, 'my-tool');
      const ticket2 = await acquirePromise;
      expect(ticket2).not.toBeNull();
    }, 10_000);

    it('should fall back to polling if subscribe throws', async () => {
      storage.supportsPubSub.mockReturnValue(true);
      storage.subscribe.mockRejectedValue(new Error('subscribe failed'));

      // Fill the single slot
      const ticket1 = await semaphore.acquire('test', 1, 0, 'my-tool');
      expect(ticket1).not.toBeNull();

      // Release after short delay — polling should pick it up
      const acquirePromise = semaphore.acquire('test', 1, 2000, 'my-tool');
      setTimeout(() => ticket1!.release(), 50);

      const ticket2 = await acquirePromise;
      expect(ticket2).not.toBeNull();
    }, 10_000);

    it('should ignore unsubscribe failure on cleanup', async () => {
      const mockUnsubscribe = jest.fn().mockRejectedValue(new Error('unsubscribe failed'));

      storage.supportsPubSub.mockReturnValue(true);
      storage.subscribe.mockResolvedValue(mockUnsubscribe);

      // Fill the single slot
      const ticket1 = await semaphore.acquire('test', 1, 0, 'my-tool');
      expect(ticket1).not.toBeNull();

      // Release after short delay
      const acquirePromise = semaphore.acquire('test', 1, 2000, 'my-tool');
      setTimeout(() => ticket1!.release(), 50);

      const ticket2 = await acquirePromise;
      expect(ticket2).not.toBeNull();
      // Should not have thrown despite unsubscribe failure
    }, 10_000);
  });

  describe('different keys', () => {
    it('should track concurrency independently per key', async () => {
      // Fill key-a (limit 1)
      await semaphore.acquire('key-a', 1, 0, 'tool-a');
      const rejectedA = await semaphore.acquire('key-a', 1, 0, 'tool-a');
      expect(rejectedA).toBeNull();

      // key-b should still work
      const ticketB = await semaphore.acquire('key-b', 1, 0, 'tool-b');
      expect(ticketB).not.toBeNull();
    });
  });
});
