import { SlidingWindowRateLimiter } from '../index';
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
    mset: jest.fn().mockImplementation(async (entries: Array<{ key: string; value: string }>) => {
      for (const { key, value } of entries) {
        data.set(key, value);
      }
    }),
    mdelete: jest.fn().mockImplementation(async (keys: string[]) => {
      let deleted = 0;
      for (const k of keys) {
        if (data.delete(k)) deleted++;
      }
      return deleted;
    }),
    expire: jest.fn().mockResolvedValue(true),
    ttl: jest.fn().mockResolvedValue(-1),
    keys: jest.fn().mockImplementation(async (pattern?: string) => {
      const allKeys = Array.from(data.keys());
      if (!pattern || pattern === '*') return allKeys;
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return allKeys.filter((k) => regex.test(k));
    }),
    count: jest.fn().mockImplementation(async () => data.size),
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

// Note: Storage error/resilience tests (e.g., storage failures, malformed data)
// are optional and can be added separately if desired.
describe('SlidingWindowRateLimiter', () => {
  let storage: jest.Mocked<StorageAdapter>;
  let limiter: SlidingWindowRateLimiter;
  let nowSpy: jest.SpyInstance;

  beforeEach(() => {
    storage = createMockStorage();
    limiter = new SlidingWindowRateLimiter(storage);
    nowSpy = jest.spyOn(Date, 'now');
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  describe('check', () => {
    it('should allow the first request', async () => {
      nowSpy.mockReturnValue(60_500); // 500ms into the second window
      const result = await limiter.check('test-key', 10, 60_000);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9);
      expect(result.retryAfterMs).toBeUndefined();
    });

    it('should track requests and decrement remaining', async () => {
      // Fixed time at the start of a window
      nowSpy.mockReturnValue(120_000);

      for (let i = 0; i < 5; i++) {
        const result = await limiter.check('test-key', 10, 60_000);
        expect(result.allowed).toBe(true);
      }

      const result = await limiter.check('test-key', 10, 60_000);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4); // 10 - 5 - 1 = 4
    });

    it('should reject when maxRequests is reached', async () => {
      nowSpy.mockReturnValue(120_000);

      // Make 10 requests
      for (let i = 0; i < 10; i++) {
        const result = await limiter.check('test-key', 10, 60_000);
        expect(result.allowed).toBe(true);
      }

      // 11th should be rejected
      const result = await limiter.check('test-key', 10, 60_000);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    it('should set expire on the current window key', async () => {
      nowSpy.mockReturnValue(120_000);
      await limiter.check('test-key', 10, 60_000);

      expect(storage.expire).toHaveBeenCalledWith(
        'test-key:120000',
        120, // ceil(60000 * 2 / 1000)
      );
    });

    it('should use weighted interpolation across windows', async () => {
      // Put 8 requests in the previous window
      const previousWindowStart = 60_000;
      const currentWindowStart = 120_000;
      const previousKey = `test-key:${previousWindowStart}`;

      // Pre-populate storage
      await storage.set(previousKey, '8');

      // Set time to 30 seconds into current window (50% weight from previous)
      nowSpy.mockReturnValue(currentWindowStart + 30_000);

      // estimated = 8 * 0.5 + 0 = 4
      const result = await limiter.check('test-key', 10, 60_000);
      expect(result.allowed).toBe(true);
      // remaining = floor(10 - 4 - 1) = 5
      expect(result.remaining).toBe(5);
    });

    it('should reject based on weighted interpolation', async () => {
      // Put 10 requests in the previous window
      const previousWindowStart = 60_000;
      const currentWindowStart = 120_000;
      const previousKey = `test-key:${previousWindowStart}`;

      await storage.set(previousKey, '10');

      // Set time to 10 seconds into current window (83% weight from previous)
      nowSpy.mockReturnValue(currentWindowStart + 10_000);

      // estimated = 10 * (50/60) + 0 = ~8.33
      // With max 8, should reject
      const result = await limiter.check('test-key', 8, 60_000);
      expect(result.allowed).toBe(false);
    });

    it('should apply full previous weight at exact window start', async () => {
      const previousWindowStart = 60_000;
      const currentWindowStart = 120_000;
      const previousKey = `test-key:${previousWindowStart}`;

      await storage.set(previousKey, '8');

      // Exact start of current window: elapsed=0, weight=1 (full previous weight)
      nowSpy.mockReturnValue(currentWindowStart);

      // estimated = 8 * 1 + 0 = 8, limit=10 → allowed, remaining = floor(10-8-1) = 1
      const result = await limiter.check('test-key', 10, 60_000);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1);
    });

    it('should treat last ms before window boundary as end of current window', async () => {
      // At 119999ms, Math.floor(119999/60000)*60000 = 60000 (still in that window)
      const currentKey = `test-key:${60_000}`;
      await storage.set(currentKey, '8');

      nowSpy.mockReturnValue(119_999);

      // elapsed=59999, weight=1/60000≈0, estimated ≈ 0 + 8 = 8
      // limit=10 → allowed, remaining = floor(10-8-1) = 1
      const result = await limiter.check('test-key', 10, 60_000);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1);
    });

    it('should handle different keys independently', async () => {
      nowSpy.mockReturnValue(120_000);

      // Fill up key-a
      for (let i = 0; i < 3; i++) {
        await limiter.check('key-a', 3, 60_000);
      }

      // key-a should be exhausted
      const resultA = await limiter.check('key-a', 3, 60_000);
      expect(resultA.allowed).toBe(false);

      // key-b should still work
      const resultB = await limiter.check('key-b', 3, 60_000);
      expect(resultB.allowed).toBe(true);
    });

    it('should return resetMs indicating time until window resets', async () => {
      nowSpy.mockReturnValue(120_000 + 15_000); // 15s into window
      const result = await limiter.check('test-key', 10, 60_000);

      expect(result.resetMs).toBe(45_000); // 60000 - 15000
    });
  });

  describe('reset', () => {
    it('should delete both window counters', async () => {
      nowSpy.mockReturnValue(120_000);
      await limiter.reset('test-key', 60_000);

      expect(storage.mdelete).toHaveBeenCalledWith(expect.arrayContaining(['test-key:120000', 'test-key:60000']));
    });

    it('should be idempotent for nonexistent keys', async () => {
      nowSpy.mockReturnValue(120_000);
      await expect(limiter.reset('nonexistent-key', 60_000)).resolves.not.toThrow();
      expect(storage.mdelete).toHaveBeenCalledWith(
        expect.arrayContaining(['nonexistent-key:120000', 'nonexistent-key:60000']),
      );
    });
  });
});
