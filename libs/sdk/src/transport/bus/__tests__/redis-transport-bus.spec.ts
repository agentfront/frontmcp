import { MethodNotImplementedError } from '../../../errors/transport.errors';
import type { TransportKey } from '../../transport.types';
import { RedisTransportBus, type BusRedisClient } from '../redis-transport-bus';

function createMockRedis(): jest.Mocked<BusRedisClient> {
  return {
    hset: jest.fn().mockResolvedValue(1),
    hdel: jest.fn().mockResolvedValue(1),
    hget: jest.fn().mockResolvedValue(null),
    expire: jest.fn().mockResolvedValue(1),
    del: jest.fn().mockResolvedValue(1),
    publish: jest.fn().mockResolvedValue(1),
    eval: jest.fn().mockResolvedValue(1),
  };
}

function createKey(overrides?: Partial<TransportKey>): TransportKey {
  return {
    type: 'streamable-http',
    token: 'test-token',
    tokenHash: 'abc123hash',
    sessionId: 'session-001',
    ...overrides,
  };
}

describe('RedisTransportBus', () => {
  let redis: jest.Mocked<BusRedisClient>;
  let bus: RedisTransportBus;

  beforeEach(() => {
    redis = createMockRedis();
    bus = new RedisTransportBus(redis, 'node-1');
  });

  describe('nodeId()', () => {
    it('returns the machine ID passed to constructor', () => {
      expect(bus.nodeId()).toBe('node-1');
    });
  });

  describe('advertise()', () => {
    it('stores nodeId and channel in Redis Hash with TTL', async () => {
      const key = createKey();
      await bus.advertise(key);

      const expectedRedisKey = `mcp:bus:streamable-http:abc123hash:session-001`;
      expect(redis.hset).toHaveBeenCalledWith(expectedRedisKey, 'nodeId', 'node-1');
      expect(redis.hset).toHaveBeenCalledWith(expectedRedisKey, 'channel', 'mcp:ha:notify:node-1');
      expect(redis.expire).toHaveBeenCalledWith(expectedRedisKey, 3600);
    });

    it('uses custom key prefix and TTL', async () => {
      bus = new RedisTransportBus(redis, 'node-2', {
        keyPrefix: 'custom:bus:',
        ttlSeconds: 7200,
        haKeyPrefix: 'custom:ha:',
      });

      const key = createKey();
      await bus.advertise(key);

      const expectedRedisKey = 'custom:bus:streamable-http:abc123hash:session-001';
      expect(redis.hset).toHaveBeenCalledWith(expectedRedisKey, 'nodeId', 'node-2');
      expect(redis.hset).toHaveBeenCalledWith(expectedRedisKey, 'channel', 'custom:ha:notify:node-2');
      expect(redis.expire).toHaveBeenCalledWith(expectedRedisKey, 7200);
    });
  });

  describe('revoke()', () => {
    it('uses atomic CAS to delete only if we own the key', async () => {
      const key = createKey();
      await bus.revoke(key);

      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining('HGET'),
        1,
        'mcp:bus:streamable-http:abc123hash:session-001',
        'node-1',
      );
    });
  });

  describe('lookup()', () => {
    it('returns null when session not registered', async () => {
      const result = await bus.lookup(createKey());
      expect(result).toBeNull();
    });

    it('returns null when the session is owned by this node', async () => {
      redis.hget.mockImplementation(async (_key: string, field: string) => {
        if (field === 'nodeId') return 'node-1';
        if (field === 'channel') return 'mcp:ha:notify:node-1';
        return null;
      });

      const result = await bus.lookup(createKey());
      expect(result).toBeNull();
    });

    it('returns remote location when session is owned by another node', async () => {
      redis.hget.mockImplementation(async (_key: string, field: string) => {
        if (field === 'nodeId') return 'node-2';
        if (field === 'channel') return 'mcp:ha:notify:node-2';
        return null;
      });

      const result = await bus.lookup(createKey());
      expect(result).toEqual({ nodeId: 'node-2', channel: 'mcp:ha:notify:node-2' });
    });

    it('returns null when channel is missing', async () => {
      redis.hget.mockImplementation(async (_key: string, field: string) => {
        if (field === 'nodeId') return 'node-2';
        return null;
      });

      const result = await bus.lookup(createKey());
      expect(result).toBeNull();
    });
  });

  describe('proxyRequest()', () => {
    it('throws MethodNotImplementedError', async () => {
      await expect(
        bus.proxyRequest(
          createKey(),
          {},
          { onResponseStart: jest.fn(), onResponseChunk: jest.fn(), onResponseEnd: jest.fn() },
        ),
      ).rejects.toThrow(MethodNotImplementedError);
    });
  });

  describe('destroyRemote()', () => {
    it('publishes destroy command to the owning pod channel', async () => {
      redis.hget.mockImplementation(async (_key: string, field: string) => {
        if (field === 'nodeId') return 'node-2';
        if (field === 'channel') return 'mcp:ha:notify:node-2';
        return null;
      });

      await bus.destroyRemote(createKey(), 'session terminated');

      expect(redis.publish).toHaveBeenCalledWith(
        'mcp:ha:notify:node-2',
        expect.stringContaining('"kind":"destroy-session"'),
      );
      // Should NOT call del — let the owning node revoke after destroy
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('does nothing when session is owned by this node', async () => {
      redis.hget.mockImplementation(async (_key: string, field: string) => {
        if (field === 'nodeId') return 'node-1';
        return null;
      });

      await bus.destroyRemote(createKey(), 'test');

      expect(redis.publish).not.toHaveBeenCalled();
    });

    it('does nothing when session not found', async () => {
      await bus.destroyRemote(createKey(), 'test');

      expect(redis.publish).not.toHaveBeenCalled();
    });
  });

  describe('logger integration', () => {
    it('logs debug messages when logger is provided', async () => {
      const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
      bus = new RedisTransportBus(redis, 'node-1', { logger });

      await bus.advertise(createKey());
      expect(logger.debug).toHaveBeenCalledWith(
        '[TransportBus] Advertised session',
        expect.objectContaining({ nodeId: 'node-1' }),
      );
    });
  });
});
