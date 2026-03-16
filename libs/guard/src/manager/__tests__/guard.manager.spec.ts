import { GuardManager } from '../index';
import type { NamespacedStorage, StorageAdapter } from '@frontmcp/utils';
import type { GuardConfig } from '../index';
import type { PartitionKeyContext } from '../../partition-key/index';

function createMockNamespacedStorage(): jest.Mocked<NamespacedStorage> {
  const data = new Map<string, string>();

  const adapter: jest.Mocked<StorageAdapter> = {
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

  return {
    ...adapter,
    prefix: 'mcp:guard:',
    namespace: jest.fn().mockReturnThis(),
    root: adapter,
  } as unknown as jest.Mocked<NamespacedStorage>;
}

describe('GuardManager', () => {
  let storage: jest.Mocked<NamespacedStorage>;
  let context: PartitionKeyContext;

  const baseConfig: GuardConfig = {
    enabled: true,
    keyPrefix: 'mcp:guard:',
  };

  beforeEach(() => {
    storage = createMockNamespacedStorage();
    context = {
      sessionId: 'sess-123',
      clientIp: '10.0.0.1',
      userId: 'user-456',
    };
  });

  describe('checkRateLimit', () => {
    it('should allow requests when no rate limit is configured', async () => {
      const manager = new GuardManager(storage, baseConfig);
      const result = await manager.checkRateLimit('my-tool', undefined, context);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(Infinity);
    });

    it('should check rate limit with entity config', async () => {
      const manager = new GuardManager(storage, baseConfig);
      const result = await manager.checkRateLimit(
        'my-tool',
        { maxRequests: 10, windowMs: 60_000, partitionBy: 'global' },
        context,
      );

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9);
    });

    it('should use defaultRateLimit when entity has no config', async () => {
      const config: GuardConfig = {
        ...baseConfig,
        defaultRateLimit: { maxRequests: 5, windowMs: 30_000 },
      };
      const manager = new GuardManager(storage, config);

      const result = await manager.checkRateLimit('my-tool', undefined, context);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
    });

    it('should prefer entity config over defaultRateLimit', async () => {
      const config: GuardConfig = {
        ...baseConfig,
        defaultRateLimit: { maxRequests: 5 },
      };
      const manager = new GuardManager(storage, config);

      const result = await manager.checkRateLimit('my-tool', { maxRequests: 100 }, context);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(99);
    });

    it('should partition by IP when configured', async () => {
      const manager = new GuardManager(storage, baseConfig);

      await manager.checkRateLimit('my-tool', { maxRequests: 10, partitionBy: 'ip' }, context);

      // The storage key should include the IP
      expect(storage.mget).toHaveBeenCalledWith(
        expect.arrayContaining([expect.stringContaining('my-tool:10.0.0.1:rl')]),
      );
    });

    it('should reject after maxRequests is reached', async () => {
      const manager = new GuardManager(storage, baseConfig);

      for (let i = 0; i < 3; i++) {
        const result = await manager.checkRateLimit('my-tool', { maxRequests: 3 }, context);
        expect(result.allowed).toBe(true);
      }

      const result = await manager.checkRateLimit('my-tool', { maxRequests: 3 }, context);
      expect(result.allowed).toBe(false);
    });
  });

  describe('checkGlobalRateLimit', () => {
    it('should allow when no global config', async () => {
      const manager = new GuardManager(storage, baseConfig);
      const result = await manager.checkGlobalRateLimit(context);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(Infinity);
    });

    it('should check global rate limit when configured', async () => {
      const config: GuardConfig = {
        ...baseConfig,
        global: { maxRequests: 100, windowMs: 60_000, partitionBy: 'ip' },
      };
      const manager = new GuardManager(storage, config);

      const result = await manager.checkGlobalRateLimit(context);
      expect(result.allowed).toBe(true);
    });

    it('should use __global__ prefix in storage key', async () => {
      const config: GuardConfig = {
        ...baseConfig,
        global: { maxRequests: 100, partitionBy: 'global' },
      };
      const manager = new GuardManager(storage, config);

      await manager.checkGlobalRateLimit(context);

      expect(storage.mget).toHaveBeenCalledWith(
        expect.arrayContaining([expect.stringContaining('__global__:global:rl')]),
      );
    });
  });

  describe('acquireSemaphore', () => {
    it('should return null when no concurrency config', async () => {
      const manager = new GuardManager(storage, baseConfig);
      const result = await manager.acquireSemaphore('my-tool', undefined, context);

      expect(result).toBeNull();
    });

    it('should acquire a slot with entity config', async () => {
      const manager = new GuardManager(storage, baseConfig);
      const ticket = await manager.acquireSemaphore('my-tool', { maxConcurrent: 5 }, context);

      expect(ticket).not.toBeNull();
      expect(ticket!.ticket).toBeDefined();
    });

    it('should use defaultConcurrency when entity has no config', async () => {
      const config: GuardConfig = {
        ...baseConfig,
        defaultConcurrency: { maxConcurrent: 2 },
      };
      const manager = new GuardManager(storage, config);

      const ticket = await manager.acquireSemaphore('my-tool', undefined, context);
      expect(ticket).not.toBeNull();
    });

    it('should reject when concurrency limit is reached', async () => {
      const manager = new GuardManager(storage, baseConfig);

      await manager.acquireSemaphore('my-tool', { maxConcurrent: 1 }, context);
      const ticket2 = await manager.acquireSemaphore('my-tool', { maxConcurrent: 1 }, context);

      expect(ticket2).toBeNull();
    });

    it('should release slot when ticket.release() is called', async () => {
      const manager = new GuardManager(storage, baseConfig);

      const ticket1 = await manager.acquireSemaphore('my-tool', { maxConcurrent: 1 }, context);
      expect(ticket1).not.toBeNull();

      // Slot is full
      const ticket2 = await manager.acquireSemaphore('my-tool', { maxConcurrent: 1 }, context);
      expect(ticket2).toBeNull();

      // Release and try again
      await ticket1!.release();
      const ticket3 = await manager.acquireSemaphore('my-tool', { maxConcurrent: 1 }, context);
      expect(ticket3).not.toBeNull();
    });
  });

  describe('acquireGlobalSemaphore', () => {
    it('should return null when no global concurrency config', async () => {
      const manager = new GuardManager(storage, baseConfig);
      const result = await manager.acquireGlobalSemaphore(context);
      expect(result).toBeNull();
    });

    it('should acquire global slot when configured', async () => {
      const config: GuardConfig = {
        ...baseConfig,
        globalConcurrency: { maxConcurrent: 10 },
      };
      const manager = new GuardManager(storage, config);

      const ticket = await manager.acquireGlobalSemaphore(context);
      expect(ticket).not.toBeNull();
    });
  });

  describe('checkIpFilter', () => {
    it('should return undefined when no IP filter configured', () => {
      const manager = new GuardManager(storage, baseConfig);
      const result = manager.checkIpFilter('10.0.0.1');
      expect(result).toBeUndefined();
    });

    it('should return undefined when clientIp is undefined', () => {
      const config: GuardConfig = {
        ...baseConfig,
        ipFilter: { denyList: ['10.0.0.0/8'] },
      };
      const manager = new GuardManager(storage, config);
      const result = manager.checkIpFilter(undefined);
      expect(result).toBeUndefined();
    });

    it('should return allowed=false when IP is on deny list', () => {
      const config: GuardConfig = {
        ...baseConfig,
        ipFilter: { denyList: ['10.0.0.1'] },
      };
      const manager = new GuardManager(storage, config);
      const result = manager.checkIpFilter('10.0.0.1');

      expect(result).toBeDefined();
      expect(result!.allowed).toBe(false);
      expect(result!.reason).toBe('denylisted');
    });

    it('should return allowed=true when IP is on allow list', () => {
      const config: GuardConfig = {
        ...baseConfig,
        ipFilter: { allowList: ['192.168.1.0/24'], defaultAction: 'deny' },
      };
      const manager = new GuardManager(storage, config);
      const result = manager.checkIpFilter('192.168.1.50');

      expect(result).toBeDefined();
      expect(result!.allowed).toBe(true);
      expect(result!.reason).toBe('allowlisted');
    });

    it('should return default action result when IP matches neither list', () => {
      const config: GuardConfig = {
        ...baseConfig,
        ipFilter: { denyList: ['10.0.0.1'], defaultAction: 'allow' },
      };
      const manager = new GuardManager(storage, config);
      const result = manager.checkIpFilter('192.168.1.1');

      expect(result).toBeDefined();
      expect(result!.allowed).toBe(true);
      expect(result!.reason).toBe('default');
    });
  });

  describe('isIpAllowListed', () => {
    it('should return false when no IP filter configured', () => {
      const manager = new GuardManager(storage, baseConfig);
      expect(manager.isIpAllowListed('10.0.0.1')).toBe(false);
    });

    it('should return false when clientIp is undefined', () => {
      const config: GuardConfig = {
        ...baseConfig,
        ipFilter: { allowList: ['10.0.0.0/8'] },
      };
      const manager = new GuardManager(storage, config);
      expect(manager.isIpAllowListed(undefined)).toBe(false);
    });

    it('should return true when IP is on allow list', () => {
      const config: GuardConfig = {
        ...baseConfig,
        ipFilter: { allowList: ['192.168.1.0/24'] },
      };
      const manager = new GuardManager(storage, config);
      expect(manager.isIpAllowListed('192.168.1.50')).toBe(true);
    });

    it('should return false when IP is not on allow list', () => {
      const config: GuardConfig = {
        ...baseConfig,
        ipFilter: { allowList: ['192.168.1.0/24'] },
      };
      const manager = new GuardManager(storage, config);
      expect(manager.isIpAllowListed('10.0.0.1')).toBe(false);
    });
  });

  describe('acquireGlobalSemaphore (with config)', () => {
    it('should use __global__ entity name and partition key from context', async () => {
      const config: GuardConfig = {
        ...baseConfig,
        globalConcurrency: { maxConcurrent: 5, partitionBy: 'ip', queueTimeoutMs: 100 },
      };
      const manager = new GuardManager(storage, config);

      const ticket = await manager.acquireGlobalSemaphore(context);
      expect(ticket).not.toBeNull();
      expect(ticket!.ticket).toBeDefined();

      // Verify storage key includes IP partition
      expect(storage.incr).toHaveBeenCalledWith(expect.stringContaining('__global__:10.0.0.1:sem:count'));
    });

    it('should reject when global concurrency limit is reached', async () => {
      const config: GuardConfig = {
        ...baseConfig,
        globalConcurrency: { maxConcurrent: 1 },
      };
      const manager = new GuardManager(storage, config);

      await manager.acquireGlobalSemaphore(context);
      const second = await manager.acquireGlobalSemaphore(context);
      expect(second).toBeNull();
    });
  });

  describe('destroy', () => {
    it('should disconnect storage', async () => {
      const manager = new GuardManager(storage, baseConfig);
      await manager.destroy();

      expect(storage.disconnect).toHaveBeenCalled();
    });
  });
});
