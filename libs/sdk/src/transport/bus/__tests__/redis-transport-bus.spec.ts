import type { ServerRequest, ServerResponse } from '../../../common';
import { ServerRequestTokens } from '../../../common/tokens/server.tokens';
import { SessionOwnerUnreachableError } from '../../../errors/transport.errors';
import type { SessionRelay } from '../../relay/session-relay';
import type { TransportBus, TransportKey } from '../../transport.types';
import { RedisTransportBus, type BusRedisClient } from '../redis-transport-bus';

function createMockRedis(): jest.Mocked<BusRedisClient> {
  return {
    hset: jest.fn().mockResolvedValue(1),
    hgetall: jest.fn().mockResolvedValue({}),
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

function entry(fields: Record<string, string>): Record<string, string> {
  return { channel: `mcp:ha:notify:${fields['nodeId']}`, type: 'streamable-http', tokenHash: 'abc123hash', ...fields };
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
    it('stores owner, channel, type and token hash under the session id, with a TTL', async () => {
      await bus.advertise(createKey());

      const expectedRedisKey = 'mcp:bus:session:session-001';
      expect(redis.hset).toHaveBeenCalledWith(
        expectedRedisKey,
        'nodeId',
        'node-1',
        'channel',
        'mcp:ha:notify:node-1',
        'type',
        'streamable-http',
        'tokenHash',
        'abc123hash',
      );
      expect(redis.expire).toHaveBeenCalledWith(expectedRedisKey, 3600);
    });

    it('uses custom key prefix and TTL', async () => {
      bus = new RedisTransportBus(redis, 'node-2', {
        keyPrefix: 'custom:bus:',
        ttlSeconds: 7200,
        haKeyPrefix: 'custom:ha:',
      });

      await bus.advertise(createKey());

      expect(redis.hset).toHaveBeenCalledWith(
        'custom:bus:session:session-001',
        'nodeId',
        'node-2',
        'channel',
        'custom:ha:notify:node-2',
        'type',
        'streamable-http',
        'tokenHash',
        'abc123hash',
      );
      expect(redis.expire).toHaveBeenCalledWith('custom:bus:session:session-001', 7200);
      expect(bus.channelOf('node-9')).toBe('custom:ha:notify:node-9');
    });

    it('logs the advertisement when a logger is given', async () => {
      const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
      bus = new RedisTransportBus(redis, 'node-1', { logger });
      await bus.advertise(createKey());
      expect(logger.debug).toHaveBeenCalledWith('[TransportBus] Advertised session', expect.any(Object));
    });
  });

  describe('revoke()', () => {
    it('uses atomic CAS to delete only if we own the key', async () => {
      await bus.revoke(createKey());

      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining('HGET'),
        1,
        'mcp:bus:session:session-001',
        'node-1',
      );
    });
  });

  describe('lookup()', () => {
    it('returns null when session not registered', async () => {
      await expect(bus.lookup(createKey())).resolves.toBeNull();
      expect(redis.hgetall).toHaveBeenCalledWith('mcp:bus:session:session-001');
    });

    it('returns null when the session is owned by this node', async () => {
      redis.hgetall.mockResolvedValueOnce(entry({ nodeId: 'node-1' }));
      await expect(bus.lookup(createKey())).resolves.toBeNull();
    });

    it('returns remote location when session is owned by another node', async () => {
      redis.hgetall.mockResolvedValueOnce(entry({ nodeId: 'node-2' }));
      await expect(bus.lookup(createKey())).resolves.toEqual({
        nodeId: 'node-2',
        channel: 'mcp:ha:notify:node-2',
      });
    });

    it('returns null for an entry of another token or transport type', async () => {
      redis.hgetall.mockResolvedValueOnce(entry({ nodeId: 'node-2', tokenHash: 'someone-else' }));
      await expect(bus.lookup(createKey())).resolves.toBeNull();

      redis.hgetall.mockResolvedValueOnce(entry({ nodeId: 'node-2', type: 'sse' }));
      await expect(bus.lookup(createKey())).resolves.toBeNull();
    });

    it('derives the channel when the entry has none', async () => {
      redis.hgetall.mockResolvedValueOnce({ nodeId: 'node-2' });
      await expect(bus.lookup(createKey())).resolves.toEqual({
        nodeId: 'node-2',
        channel: 'mcp:ha:notify:node-2',
      });
    });
  });

  describe('lookupOwner()', () => {
    it('returns the owner whatever its type or token, this node included', async () => {
      redis.hgetall.mockResolvedValueOnce(entry({ nodeId: 'node-1', type: 'sse', tokenHash: 'x' }));
      await expect(bus.lookupOwner('session-001')).resolves.toEqual({
        nodeId: 'node-1',
        channel: 'mcp:ha:notify:node-1',
      });
    });

    it('returns null when the session is unknown', async () => {
      redis.hgetall.mockResolvedValueOnce({});
      await expect(bus.lookupOwner('session-001')).resolves.toBeNull();
    });
  });

  describe('proxyRequest()', () => {
    const location = { nodeId: 'node-2', channel: 'mcp:ha:notify:node-2' };
    const response = {} as ServerResponse;

    function request(extra: Record<PropertyKey, unknown> = {}): ServerRequest {
      return {
        method: 'POST',
        url: '/mcp',
        path: '/mcp',
        headers: { 'mcp-session-id': 'session-001' },
        query: {},
        body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        ...extra,
      } as unknown as ServerRequest;
    }

    it('cannot relay until a relay is attached', async () => {
      expect(bus.canRelay()).toBe(false);
      const error = await bus.proxyRequest(location, 'session-001', request(), response).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SessionOwnerUnreachableError);
      expect((error as SessionOwnerUnreachableError).statusCode).toBe(503);
      expect((error as SessionOwnerUnreachableError).retryAfterSeconds).toBe(30);
    });

    it('forwards the serialized request to the attached relay', async () => {
      const forward = jest.fn().mockResolvedValue(undefined);
      bus.attachRelay({ forward } as unknown as SessionRelay);
      expect(bus.canRelay()).toBe(true);

      await bus.proxyRequest(location, 'session-001', request(), response);

      expect(forward).toHaveBeenCalledWith(
        'node-2',
        'session-001',
        expect.objectContaining({ method: 'POST', url: '/mcp', body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } }),
        response,
      );
    });

    it('never relays a request a second time', async () => {
      bus = new RedisTransportBus(redis, 'node-1', { retryAfterSeconds: 7 });
      const forward = jest.fn();
      bus.attachRelay({ forward } as unknown as SessionRelay);

      const error = await bus
        .proxyRequest(location, 'session-001', request({ [ServerRequestTokens.relayedFrom]: 'node-3' }), response)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(SessionOwnerUnreachableError);
      expect((error as SessionOwnerUnreachableError).retryAfterSeconds).toBe(7);
      expect(forward).not.toHaveBeenCalled();
    });

    it('stops relaying once the relay is detached', () => {
      bus.attachRelay({ forward: jest.fn() } as unknown as SessionRelay);
      bus.attachRelay(undefined);
      expect(bus.canRelay()).toBe(false);
    });
  });

  describe('destroyRemote()', () => {
    it('publishes destroy command to the owning pod channel', async () => {
      redis.hgetall.mockResolvedValueOnce(entry({ nodeId: 'node-2' }));

      await bus.destroyRemote(createKey(), 'session expired');

      expect(redis.publish).toHaveBeenCalledWith('mcp:ha:notify:node-2', expect.any(String));
      const message = JSON.parse(redis.publish.mock.calls[0][1] as string);
      expect(message).toEqual(
        expect.objectContaining({
          kind: 'destroy-session',
          sessionId: 'session-001',
          reason: 'session expired',
          sourceNodeId: 'node-1',
        }),
      );
    });

    it('does nothing when session is owned by this node', async () => {
      redis.hgetall.mockResolvedValueOnce(entry({ nodeId: 'node-1' }));
      await bus.destroyRemote(createKey());
      expect(redis.publish).not.toHaveBeenCalled();
    });

    it('does nothing when session not found', async () => {
      await bus.destroyRemote(createKey());
      expect(redis.publish).not.toHaveBeenCalled();
    });

    it('logs the destroy request when a logger is given', async () => {
      const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
      bus = new RedisTransportBus(redis, 'node-1', { logger });
      redis.hgetall.mockResolvedValueOnce(entry({ nodeId: 'node-2' }));
      await bus.destroyRemote(createKey());
      expect(logger.info).toHaveBeenCalledWith('[TransportBus] Sent destroy-remote', expect.any(Object));
    });
  });

  describe('TransportBus interface compliance', () => {
    it('implements all TransportBus methods', () => {
      const transportBus: TransportBus = bus;
      expect(typeof transportBus.nodeId).toBe('function');
      expect(typeof transportBus.advertise).toBe('function');
      expect(typeof transportBus.revoke).toBe('function');
      expect(typeof transportBus.lookup).toBe('function');
      expect(typeof transportBus.lookupOwner).toBe('function');
      expect(typeof transportBus.channelOf).toBe('function');
      expect(typeof transportBus.canRelay).toBe('function');
      expect(typeof transportBus.proxyRequest).toBe('function');
      expect(typeof transportBus.destroyRemote).toBe('function');
    });
  });
});
