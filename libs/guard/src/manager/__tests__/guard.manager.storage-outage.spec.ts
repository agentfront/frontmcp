/**
 * #660 — `throttle.storage` on Redis went away while the server was running:
 * a rate-limited call answered `Internal FrontMCP error` instead of the
 * `GuardStorageUnavailableError` startup already raises (or the configured
 * `fallback`).
 */

import { createMemoryStorage, type NamespacedStorage } from '@frontmcp/utils';

import { ConcurrencyLimitError, GuardStorageUnavailableError, QueueTimeoutError } from '../../errors';
import { GuardManager } from '../guard.manager';
import type { GuardConfig, GuardLogger } from '../types';

interface Flaky {
  storage: NamespacedStorage;
  setDown(down: boolean): void;
}

/** A real in-memory storage whose commands reject while it is "down", like ioredis once Redis is gone. */
async function createFlakyStorage(): Promise<Flaky> {
  const root = createMemoryStorage();
  await root.connect();
  const inner = root.namespace('mcp:guard');
  let down = false;
  const storage = new Proxy(inner, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function' || prop === 'supportsPubSub' || prop === 'namespace') return value;
      return (...args: unknown[]) => {
        if (down) return Promise.reject(new Error('Connection is closed.'));
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return { storage, setDown: (d) => void (down = d) };
}

function createLogger(): jest.Mocked<GuardLogger> {
  return { info: jest.fn(), warn: jest.fn() };
}

const rateLimitConfig: GuardConfig = {
  enabled: true,
  defaultRateLimit: { maxRequests: 2, windowMs: 60_000 },
  defaultConcurrency: { maxConcurrent: 1 },
};

describe('GuardManager when the storage goes away at runtime (#660)', () => {
  describe('fail closed (no fallback)', () => {
    it('rejects a rate-limit check with GuardStorageUnavailableError naming throttle.storage', async () => {
      const { storage, setDown } = await createFlakyStorage();
      const manager = new GuardManager(storage, rateLimitConfig, { storageType: 'redis', fallback: 'error' });

      await expect(manager.checkRateLimit('tool', undefined, undefined)).resolves.toMatchObject({ allowed: true });
      setDown(true);

      const error = await manager.checkRateLimit('tool', undefined, undefined).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GuardStorageUnavailableError);
      const unavailable = error as GuardStorageUnavailableError;
      expect(unavailable.storageType).toBe('redis');
      expect(unavailable.code).toBe('GUARD_STORAGE_UNAVAILABLE');
      expect(unavailable.statusCode).toBe(503);
      expect(unavailable.message).toContain('throttle.storage (redis)');
      expect(unavailable.message).toContain('Connection is closed.');
      expect(unavailable.message).not.toMatch(/will not start/i);
      expect((unavailable.cause as Error).message).toBe('Connection is closed.');
    });

    it('rejects the global rate limit and both semaphore acquires the same way', async () => {
      const { storage, setDown } = await createFlakyStorage();
      const manager = new GuardManager(
        storage,
        { ...rateLimitConfig, global: { maxRequests: 5 }, globalConcurrency: { maxConcurrent: 5 } },
        { storageType: 'redis' },
      );
      setDown(true);

      await expect(manager.checkGlobalRateLimit(undefined)).rejects.toBeInstanceOf(GuardStorageUnavailableError);
      await expect(manager.acquireSemaphore('tool', undefined, undefined)).rejects.toBeInstanceOf(
        GuardStorageUnavailableError,
      );
      await expect(manager.acquireGlobalSemaphore(undefined)).rejects.toBeInstanceOf(GuardStorageUnavailableError);
    });

    it('defaults to failing closed when no options are given', async () => {
      const { storage, setDown } = await createFlakyStorage();
      const manager = new GuardManager(storage, rateLimitConfig);
      setDown(true);

      await expect(manager.checkRateLimit('tool', undefined, undefined)).rejects.toBeInstanceOf(
        GuardStorageUnavailableError,
      );
    });

    it('leaves limit errors that are not storage failures untouched', async () => {
      const { storage } = await createFlakyStorage();
      const manager = new GuardManager(
        storage,
        { enabled: true, defaultConcurrency: { maxConcurrent: 1, queueTimeoutMs: 30 } },
        { storageType: 'redis' },
      );

      const held = await manager.acquireSemaphore('tool', undefined, undefined);
      expect(held).not.toBeNull();
      await expect(manager.acquireSemaphore('tool', undefined, undefined)).rejects.toBeInstanceOf(QueueTimeoutError);
      await expect(manager.acquireSemaphore('tool', undefined, undefined)).rejects.not.toBeInstanceOf(
        GuardStorageUnavailableError,
      );
      await held?.release();
      expect(ConcurrencyLimitError).toBeDefined();
    });

    it('does not throw from a ticket release after the storage went down (the tool already ran)', async () => {
      const { storage, setDown } = await createFlakyStorage();
      const logger = createLogger();
      const manager = new GuardManager(storage, rateLimitConfig, { storageType: 'redis', logger });

      const ticket = await manager.acquireSemaphore('tool', undefined, undefined);
      expect(ticket).not.toBeNull();
      setDown(true);

      await expect(ticket?.release()).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0][0]).toContain('release');
    });
  });

  describe("fallback: 'memory'", () => {
    it('serves from per-instance counters, warns once, and still enforces the limit', async () => {
      const { storage, setDown } = await createFlakyStorage();
      const logger = createLogger();
      const manager = new GuardManager(storage, rateLimitConfig, {
        storageType: 'redis',
        fallback: 'memory',
        logger,
      });
      setDown(true);

      const results = [];
      for (let i = 0; i < 3; i++) results.push(await manager.checkRateLimit('tool', undefined, undefined));

      expect(results.map((r) => r.allowed)).toEqual([true, true, false]);
      const outageWarnings = logger.warn.mock.calls.filter(([m]) => /unavailable/i.test(m));
      expect(outageWarnings).toHaveLength(1);
      expect(outageWarnings[0][0]).toContain('throttle.storage (redis)');
    });

    it('serves concurrency slots from the per-instance counters too', async () => {
      const { storage, setDown } = await createFlakyStorage();
      const manager = new GuardManager(storage, rateLimitConfig, { storageType: 'redis', fallback: 'memory' });
      setDown(true);

      const first = await manager.acquireSemaphore('tool', undefined, undefined);
      const second = await manager.acquireSemaphore('tool', undefined, undefined);
      expect(first).not.toBeNull();
      expect(second).toBeNull();
      await first?.release();
    });

    it('goes back to the configured storage once it answers again', async () => {
      jest.useFakeTimers({ now: 1_700_000_000_000 });
      try {
        const { storage, setDown } = await createFlakyStorage();
        const logger = createLogger();
        const manager = new GuardManager(storage, rateLimitConfig, {
          storageType: 'redis',
          fallback: 'memory',
          logger,
          retryPrimaryAfterMs: 1_000,
        });

        setDown(true);
        await manager.checkRateLimit('tool', undefined, undefined);
        await manager.checkRateLimit('tool', undefined, undefined);
        const denied = await manager.checkRateLimit('tool', undefined, undefined);
        expect(denied.allowed).toBe(false);

        setDown(false);
        jest.setSystemTime(Date.now() + 1_500);
        // Fresh counters on the configured storage, not the exhausted memory ones.
        const recovered = await manager.checkRateLimit('tool', undefined, undefined);
        expect(recovered.allowed).toBe(true);
        expect(logger.info.mock.calls.some(([m]) => /recovered|available again/i.test(m))).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
