import {
  createMemoryStorage,
  StorageNotSupportedError,
  type NamespacedStorage,
  type SetOptions,
  type StorageAdapter,
} from '@frontmcp/utils';

import { GuardStorageUnsupportedError, QueueTimeoutError } from '../../errors/index';
import { DistributedSemaphore } from '../index';

function createMockStorage(): jest.Mocked<StorageAdapter> {
  const data = new Map<string, string>();
  const matching = (pattern = '*') =>
    [...data.keys()].filter((key) => (pattern.endsWith('*') ? key.startsWith(pattern.slice(0, -1)) : key === pattern));

  return {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    ping: jest.fn().mockResolvedValue(true),
    get: jest.fn().mockImplementation(async (key: string) => data.get(key) ?? null),
    set: jest.fn().mockImplementation(async (key: string, value: string, options?: SetOptions) => {
      if (options?.ifNotExists && data.has(key)) return;
      data.set(key, value);
    }),
    delete: jest.fn().mockImplementation(async (key: string) => data.delete(key)),
    deleteIfEquals: jest
      .fn()
      .mockImplementation(async (key: string, expected: string) =>
        data.get(key) === expected ? data.delete(key) : false,
      ),
    expireIfEquals: jest.fn().mockImplementation(async (key: string, expected: string) => data.get(key) === expected),
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
    keys: jest.fn().mockImplementation(async (pattern?: string) => matching(pattern)),
    count: jest.fn().mockImplementation(async (pattern?: string) => matching(pattern).length),
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

    it('should claim a free slot with the ticket TTL', async () => {
      const ticket = await semaphore.acquire('test', 3, 0, 'my-tool');

      expect(storage.set).toHaveBeenCalledWith('test:slot:0', ticket!.ticket, { ttlSeconds: 300, ifNotExists: true });
    });

    it('should hold the slot key until release', async () => {
      const ticket = await semaphore.acquire('test', 3, 0, 'my-tool');
      expect(await storage.get('test:slot:0')).toBe(ticket!.ticket);

      await ticket!.release();
      expect(await storage.get('test:slot:0')).toBeNull();
    });

    it('should take the next free slot when another acquirer claims the same one first', async () => {
      storage.set.mockImplementationOnce(async (key: string) => {
        await storage.set(key, 'other-ticket');
      });

      const ticket = await semaphore.acquire('test', 2, 0, 'my-tool');

      expect(await storage.get('test:slot:0')).toBe('other-ticket');
      expect(await storage.get('test:slot:1')).toBe(ticket!.ticket);
    });
  });

  describe('release', () => {
    it('should release the slot with a compare-and-delete of its own ticket', async () => {
      const ticket = await semaphore.acquire('test', 3, 0, 'my-tool');
      expect(ticket).not.toBeNull();

      await ticket!.release();

      expect(storage.deleteIfEquals).toHaveBeenCalledWith('test:slot:0', ticket!.ticket);
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

    it('should not free a slot that another ticket holds since this one expired', async () => {
      const ticket = await semaphore.acquire('test', 1, 0, 'my-tool');
      await storage.set('test:slot:0', 'newer-ticket');

      await ticket!.release();

      expect(await storage.get('test:slot:0')).toBe('newer-ticket');
      expect(await semaphore.acquire('test', 1, 0, 'my-tool')).toBeNull();
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
    it('should delete every slot key', async () => {
      await semaphore.acquire('test', 2, 0, 'my-tool');
      await semaphore.acquire('test', 2, 0, 'my-tool');

      await semaphore.forceReset('test');

      expect(storage.mdelete).toHaveBeenCalledWith(['test:slot:0', 'test:slot:1']);
      expect(await semaphore.getActiveCount('test')).toBe(0);
    });

    it('should handle no held slots', async () => {
      await semaphore.forceReset('test');

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

      // Poll 2 (the first in waitForSlot) fails and notifies; poll 3 runs without sleeping and finds the slot free.
      const originalMget = storage.mget.getMockImplementation()!;
      storage.mget.mockImplementation(async (keys: string[]) => {
        if (keys[0] === 'notify-test:slot:0') {
          pollCount++;
          if (pollCount === 3) {
            await storage.delete('notify-test:slot:0');
          }
          if (pollCount === 2) {
            const result = await originalMget(keys);
            if (subscribeCallback) subscribeCallback();
            return result;
          }
        }
        return originalMget(keys);
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

describe('DistributedSemaphore ticket TTL', () => {
  const ticketTtlSeconds = 3;
  let storage: NamespacedStorage;
  let semaphore: DistributedSemaphore;

  beforeEach(async () => {
    jest.useFakeTimers();
    const root = createMemoryStorage({ enableSweeper: false });
    await root.connect();
    storage = root.namespace('mcp:guard');
    semaphore = new DistributedSemaphore(storage, ticketTtlSeconds);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /** Moves the clock without running timers, as an event loop blocked for that long would. */
  const stallPastTicketTtl = () => jest.setSystemTime(Date.now() + ticketTtlSeconds * 1000 + 1);

  it('holds the slot while its execution runs longer than the ticket TTL', async () => {
    const running = await semaphore.acquire('tool:global', 1, 0, 'tool');

    await jest.advanceTimersByTimeAsync(ticketTtlSeconds * 1000 * 10);

    expect(await semaphore.getActiveCount('tool:global')).toBe(1);
    expect(await semaphore.acquire('tool:global', 1, 0, 'tool')).toBeNull();
    await running!.release();
    expect(await semaphore.acquire('tool:global', 1, 0, 'tool')).not.toBeNull();
  });

  it('frees the slot of a holder that died, once the ticket TTL runs out', async () => {
    await storage.set('tool:global:slot:0', 'ticket-of-a-crashed-process', { ttlSeconds: ticketTtlSeconds });
    expect(await semaphore.acquire('tool:global', 1, 0, 'tool')).toBeNull();

    await jest.advanceTimersByTimeAsync(ticketTtlSeconds * 1000 + 1);

    expect(await semaphore.getActiveCount('tool:global')).toBe(0);
    expect(await semaphore.acquire('tool:global', 1, 0, 'tool')).not.toBeNull();
  });

  it('stops renewing a slot once it is released', async () => {
    const renew = jest.spyOn(storage, 'expireIfEquals');
    const ticket = await semaphore.acquire('tool:global', 1, 0, 'tool');
    await jest.advanceTimersByTimeAsync(ticketTtlSeconds * 1000);
    const renewalsWhileHeld = renew.mock.calls.length;

    await ticket!.release();
    await jest.advanceTimersByTimeAsync(ticketTtlSeconds * 1000 * 3);

    expect(renewalsWhileHeld).toBeGreaterThan(0);
    expect(renew.mock.calls.length).toBe(renewalsWhileHeld);
    expect(await semaphore.getActiveCount('tool:global')).toBe(0);
  });

  it('keeps the slot of a newer ticket when a stalled holder renews or releases late', async () => {
    const stalled = await semaphore.acquire('tool:global', 1, 0, 'tool');
    stallPastTicketTtl();
    const newer = await semaphore.acquire('tool:global', 1, 0, 'tool');
    expect(newer).not.toBeNull();

    await jest.advanceTimersByTimeAsync(ticketTtlSeconds * 1000);
    await stalled!.release();

    expect(await storage.get('tool:global:slot:0')).toBe(newer!.ticket);
    expect(await semaphore.acquire('tool:global', 1, 0, 'tool')).toBeNull();
  });

  it('admits no more than maxConcurrent of many simultaneous acquirers', async () => {
    const tickets = await Promise.all(Array.from({ length: 10 }, () => semaphore.acquire('tool:global', 3, 0, 'tool')));

    expect(tickets.filter((ticket) => ticket !== null)).toHaveLength(3);
    expect(await semaphore.getActiveCount('tool:global')).toBe(3);
  });

  it("counts and resets only a key's own slots, not those of a key that extends it", async () => {
    await semaphore.acquire('tool', 2, 0, 'tool');
    await semaphore.acquire('tool:slot:0', 2, 0, 'tool');

    expect(await semaphore.getActiveCount('tool')).toBe(1);
    await semaphore.forceReset('tool');

    expect(await semaphore.getActiveCount('tool')).toBe(0);
    expect(await semaphore.getActiveCount('tool:slot:0')).toBe(1);
  });
});

describe('DistributedSemaphore storage requirements', () => {
  it.each([
    ['has no compare-and-delete', { deleteIfEquals: undefined }],
    ['has no compare-and-expire', { expireIfEquals: undefined }],
    [
      'cannot compare and delete atomically',
      { deleteIfEquals: jest.fn().mockRejectedValue(new StorageNotSupportedError('deleteIfEquals', 'filesystem')) },
    ],
  ])('refuses a storage adapter that %s, before claiming a slot', async (_description, overrides) => {
    const storage = { ...createMockStorage(), ...overrides } as jest.Mocked<StorageAdapter>;
    const semaphore = new DistributedSemaphore(storage, 300);

    await expect(semaphore.acquire('test', 1, 0, 'my-tool')).rejects.toBeInstanceOf(GuardStorageUnsupportedError);
    expect(storage.set).not.toHaveBeenCalled();
  });
});
