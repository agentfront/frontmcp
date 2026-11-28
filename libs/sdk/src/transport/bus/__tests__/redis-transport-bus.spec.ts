import type { ServerRequest, ServerResponse } from '../../../common';
import { ServerRequestTokens } from '../../../common/tokens/server.tokens';
import { SessionEndUnconfirmedError, SessionOwnerUnreachableError } from '../../../errors/transport.errors';
import type { SessionRelay } from '../../relay/session-relay';
import type { TransportBus, TransportKey } from '../../transport.types';
import { RedisTransportBus, type BusRedisClient } from '../redis-transport-bus';

function createMockRedis(): jest.Mocked<BusRedisClient> {
  return {
    hgetall: jest.fn().mockResolvedValue({}),
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
    it('stores owner, channel, type and token hash under the session id with its TTL, in one atomic script', async () => {
      await bus.advertise(createKey());

      expect(redis.eval).toHaveBeenCalledTimes(1);
      const [script, numKeys, ...args] = redis.eval.mock.calls[0];
      expect(script).toMatch(/HSET[\s\S]*EXPIRE/);
      expect(numKeys).toBe(1);
      expect(args).toEqual([
        'mcp:bus:session:session-001',
        'node-1',
        'mcp:ha:notify:node-1',
        'streamable-http',
        'abc123hash',
        3600,
      ]);
    });

    it('uses custom key prefix and TTL', async () => {
      bus = new RedisTransportBus(redis, 'node-2', {
        keyPrefix: 'custom:bus:',
        ttlSeconds: 7200,
        haKeyPrefix: 'custom:ha:',
      });

      await bus.advertise(createKey());

      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining('HSET'),
        1,
        'custom:bus:session:session-001',
        'node-2',
        'custom:ha:notify:node-2',
        'streamable-http',
        'abc123hash',
        7200,
      );
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
    /** The destroy message the bus published (the n-th publish). */
    function published(n = 0): { requestId: string } & Record<string, unknown> {
      return JSON.parse(redis.publish.mock.calls[n][1] as string);
    }

    /** Run `body` on fake timers and give it a bus with a logger. */
    async function withFakeTimers(
      body: (logger: { info: jest.Mock; warn: jest.Mock; debug: jest.Mock }) => Promise<void>,
    ) {
      jest.useFakeTimers();
      try {
        const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
        bus = new RedisTransportBus(redis, 'node-1', { logger });
        await body(logger);
      } finally {
        jest.useRealTimers();
      }
    }

    it('publishes destroy command to the owning pod channel, with the id its answer names', async () => {
      redis.hgetall.mockResolvedValueOnce(entry({ nodeId: 'node-2' }));

      await bus.destroyRemote(createKey(), 'session expired');

      expect(redis.publish).toHaveBeenCalledWith('mcp:ha:notify:node-2', expect.any(String));
      expect(published()).toEqual(
        expect.objectContaining({
          kind: 'destroy-session',
          sessionId: 'session-001',
          reason: 'session expired',
          sourceNodeId: 'node-1',
          requestId: expect.any(String),
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

    it("resolves on the owner's answer that it closed the session, its entry still there (#1446)", async () => {
      await withFakeTimers(async () => {
        redis.hgetall.mockResolvedValue(entry({ nodeId: 'node-2' }));
        redis.publish.mockImplementation(async (_channel, raw) => {
          const { requestId } = JSON.parse(raw);
          setTimeout(
            () =>
              bus.handleSessionDestroyed({
                kind: 'session-destroyed',
                requestId,
                sessionId: 'session-001',
                held: true,
                sourceNodeId: 'node-2',
              }),
            100,
          );
          return 1;
        });
        let resolved = false;
        const destroyed = bus.destroyRemote(createKey()).then(() => (resolved = true));

        await jest.advanceTimersByTimeAsync(90);
        expect(resolved).toBe(false);
        await jest.advanceTimersByTimeAsync(20);
        await destroyed;
        expect(resolved).toBe(true);
      });
    });

    it('takes no answer from another node, or for another request', async () => {
      await withFakeTimers(async () => {
        redis.hgetall.mockResolvedValue(entry({ nodeId: 'node-2' }));
        const destroyed = bus.destroyRemote(createKey()).catch((error: unknown) => error);
        await jest.advanceTimersByTimeAsync(0);
        const { requestId } = published();
        const answer = { kind: 'session-destroyed' as const, sessionId: 'session-001', held: true };
        bus.handleSessionDestroyed({ ...answer, requestId, sourceNodeId: 'node-3' });
        bus.handleSessionDestroyed({ ...answer, requestId: 'another', sourceNodeId: 'node-2' });

        await jest.advanceTimersByTimeAsync(5_000);
        expect(await destroyed).toBeInstanceOf(SessionEndUnconfirmedError);
      });
    });

    it("resolves once the owner revoked the session's entry, which it does after closing the transport", async () => {
      let ownerClosed = false;
      redis.hgetall.mockImplementation(async () => (ownerClosed ? {} : entry({ nodeId: 'node-2' })));
      redis.publish.mockImplementation(async () => {
        setTimeout(() => (ownerClosed = true), 100);
        return 1;
      });

      await bus.destroyRemote(createKey());

      expect(ownerClosed).toBe(true);
    });

    it('keeps waiting when another node took the session over: the owner may still run its calls', async () => {
      await withFakeTimers(async () => {
        redis.hgetall.mockResolvedValueOnce(entry({ nodeId: 'node-2' })).mockResolvedValue(entry({ nodeId: 'node-3' }));
        const destroyed = bus.destroyRemote(createKey()).catch((error: unknown) => error);

        await jest.advanceTimersByTimeAsync(5_000);
        expect(await destroyed).toEqual(expect.objectContaining({ kind: 'timed-out', holder: 'node-2' }));
      });
    });

    it('answers a retryable 503 after the bounded wait when the owner never confirms', async () => {
      await withFakeTimers(async (logger) => {
        redis.hgetall.mockResolvedValue(entry({ nodeId: 'node-2' }));
        let settled = false;
        const destroyed = bus.destroyRemote(createKey()).catch((error: unknown) => {
          settled = true;
          return error;
        });

        await jest.advanceTimersByTimeAsync(4_900);
        expect(settled).toBe(false);
        await jest.advanceTimersByTimeAsync(200);
        const error = (await destroyed) as SessionEndUnconfirmedError;

        expect(error).toBeInstanceOf(SessionEndUnconfirmedError);
        expect(error.statusCode).toBe(503);
        expect(error.retryAfterSeconds).toBe(30);
        expect(error.kind).toBe('timed-out');
        expect(logger.warn).toHaveBeenCalledWith(
          '[TransportBus] The session owner did not confirm in time that it closed the session',
          expect.objectContaining({ ownerNodeId: 'node-2' }),
        );
      });
    });

    it('answers by the deadline when Redis never answers a read of the entry, and keeps polling past a failed one', async () => {
      await withFakeTimers(async () => {
        redis.hgetall
          .mockResolvedValueOnce(entry({ nodeId: 'node-2' }))
          .mockRejectedValueOnce(new Error('READONLY'))
          .mockImplementation(() => new Promise<never>(() => undefined));
        let settled = false;
        const destroyed = bus.destroyRemote(createKey()).catch((error: unknown) => {
          settled = true;
          return error;
        });

        await jest.advanceTimersByTimeAsync(4_900);
        expect(settled).toBe(false);
        await jest.advanceTimersByTimeAsync(100);

        expect(await destroyed).toBeInstanceOf(SessionEndUnconfirmedError);
        expect(redis.hgetall).toHaveBeenCalledTimes(3);
      });
    });

    it('answers at once when no node listens on the owner channel, as nobody can close the session', async () => {
      redis.hgetall.mockResolvedValue(entry({ nodeId: 'node-2' }));
      redis.publish.mockResolvedValueOnce(0);

      const error = await bus.destroyRemote(createKey()).catch((caught: unknown) => caught);

      expect(error).toEqual(expect.objectContaining({ kind: 'not-listening', holder: 'node-2' }));
      expect(redis.hgetall).toHaveBeenCalledTimes(1);
    });

    it('logs the destroy request when a logger is given', async () => {
      const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
      bus = new RedisTransportBus(redis, 'node-1', { logger });
      redis.hgetall.mockResolvedValueOnce(entry({ nodeId: 'node-2' }));
      await bus.destroyRemote(createKey());
      expect(logger.info).toHaveBeenCalledWith('[TransportBus] Sent destroy-remote', expect.any(Object));
    });
  });

  describe('revokeSession()', () => {
    it("removes this node's entry for a session, only while it names this node", async () => {
      await bus.revokeSession('session-001');
      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining('HGET'),
        1,
        'mcp:bus:session:session-001',
        'node-1',
      );
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
