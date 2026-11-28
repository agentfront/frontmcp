/**
 * The cluster-aware helpers: today's call on a single node, per-key or per-master on a cluster (#1503).
 */
import { borrowRedisClient, isBorrowedRedisClient } from '../borrow';
import {
  deleteRedisKeys,
  getRedisKeys,
  isRedisClusterClient,
  publishRedisMessage,
  redisMasterNodes,
  scanRedisKeys,
} from '../cluster-ops';
import { isRedisConnection, redisAdapterOptionsOf, redisConnectionOf } from '../config';
import {
  detectRedisClientKind,
  isRedisClientInput,
  missingRedisClientMethods,
  redisClientProblem,
  REQUIRED_REDIS_CLIENT_METHODS,
} from '../detect';
import type { FrontMcpRedisClient } from '../types';

/** A node holding `keys`, scanned two at a time. */
function node(keys: string[]) {
  return {
    scan: jest.fn(async (cursor: string) => {
      const start = Number(cursor);
      const next = start + 2 >= keys.length ? '0' : String(start + 2);
      return [next, keys.slice(start, start + 2)] as [string, string[]];
    }),
    del: jest.fn(async (...names: string[]) => names.length),
    mget: jest.fn(async (...names: string[]) => names.map((name) => `v:${name}`)),
    get: jest.fn(async (name: string) => `v:${name}`),
    ping: jest.fn(async () => 'PONG'),
  };
}

function cluster(masters: ReturnType<typeof node>[], { emptyUntilPing = false } = {}) {
  let pinged = false;
  const self = {
    ...node([]),
    isCluster: true,
    ping: jest.fn(async () => {
      pinged = true;
      return 'PONG';
    }),
    nodes: jest.fn(() => (emptyUntilPing && !pinged ? [] : masters)),
  };
  return self;
}

const asClient = (value: unknown) => value as FrontMcpRedisClient;

describe('scanRedisKeys', () => {
  it('runs the SCAN loop on a single node', async () => {
    const single = node(['a', 'b', 'c']);
    await expect(scanRedisKeys(asClient(single), 'p*')).resolves.toEqual(['a', 'b', 'c']);
    expect(single.scan).toHaveBeenCalledWith('0', 'MATCH', 'p*', 'COUNT', 100);
    expect(single.scan).toHaveBeenCalledTimes(2);
  });

  it('scans every master of a cluster, reporting a key seen twice once', async () => {
    const masters = [node(['a', 'b', 'c']), node(['d', 'c'])];
    const keys = await scanRedisKeys(asClient(cluster(masters)), 'p*', 50);
    expect(keys.sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(masters[1].scan).toHaveBeenCalledWith('0', 'MATCH', 'p*', 'COUNT', 50);
  });

  it('waits for a cluster still discovering its masters', async () => {
    const client = cluster([node(['a'])], { emptyUntilPing: true });
    await expect(scanRedisKeys(asClient(client), '*')).resolves.toEqual(['a']);
    expect(client.ping).toHaveBeenCalledTimes(1);
  });
});

describe('deleteRedisKeys', () => {
  it('sends one DEL to a single node', async () => {
    const single = node([]);
    await expect(deleteRedisKeys(asClient(single), ['a', 'b'])).resolves.toBe(2);
    expect(single.del).toHaveBeenCalledWith('a', 'b');
  });

  it('sends one DEL per key to a cluster and adds up the counts', async () => {
    const client = cluster([]);
    await expect(deleteRedisKeys(asClient(client), ['a', 'b', 'c'])).resolves.toBe(3);
    expect(client.del.mock.calls).toEqual([['a'], ['b'], ['c']]);
  });

  it('sends nothing for no keys', async () => {
    const single = node([]);
    await expect(deleteRedisKeys(asClient(single), [])).resolves.toBe(0);
    expect(single.del).not.toHaveBeenCalled();
  });
});

describe('getRedisKeys', () => {
  it('sends one MGET to a single node', async () => {
    const single = node([]);
    await expect(getRedisKeys(asClient(single), ['a', 'b'])).resolves.toEqual(['v:a', 'v:b']);
    expect(single.mget).toHaveBeenCalledWith('a', 'b');
  });

  it('sends one GET per key to a cluster, in order', async () => {
    const client = cluster([]);
    await expect(getRedisKeys(asClient(client), ['a', 'b'])).resolves.toEqual(['v:a', 'v:b']);
    expect(client.mget).not.toHaveBeenCalled();
  });

  it('sends nothing for no keys', async () => {
    await expect(getRedisKeys(asClient(node([])), [])).resolves.toEqual([]);
  });
});

describe('redisMasterNodes / isRedisClusterClient', () => {
  it('treats a single node as its own only master', async () => {
    const single = node([]);
    await expect(redisMasterNodes(asClient(single))).resolves.toEqual([single]);
    expect(isRedisClusterClient(asClient(single))).toBe(false);
    expect(isRedisClusterClient(undefined)).toBe(false);
  });
});

describe('detectRedisClientKind', () => {
  const ioredis = (isCluster: boolean) => ({
    status: 'ready',
    isCluster,
    call() {},
    duplicate() {},
    sendCommand() {},
  });
  const nodeRedis = { isOpen: false, sendCommand() {}, connect() {}, duplicate() {} };

  it.each([
    ['an ioredis Redis', ioredis(false), 'ioredis'],
    ['an ioredis Cluster', ioredis(true), 'ioredis-cluster'],
    ['a node-redis client', nodeRedis, 'node-redis'],
    ['a node-redis cluster', { ...nodeRedis, masters: [], nodeClient() {} }, 'node-redis-cluster'],
    ['a FrontMcpRedisClient', { get() {}, set() {}, del() {} }, 'custom'],
    ['an object with no commands', { ping() {} }, undefined],
    ['null', null, undefined],
    ['a string', 'redis://x', undefined],
  ])('%s -> %p', (_label, value, kind) => {
    expect(detectRedisClientKind(value)).toBe(kind);
    // A custom object is a client to take only with every required method (see the next test)
    expect(isRedisClientInput(value)).toBe(kind !== undefined && kind !== 'custom');
  });

  it('takes a custom client with every required method, and says what a partial one lacks', () => {
    const full = Object.fromEntries(REQUIRED_REDIS_CLIENT_METHODS.map((name) => [name, () => undefined]));
    expect(isRedisClientInput(full)).toBe(true);
    expect(missingRedisClientMethods(full)).toEqual([]);
    const { eval: _eval, ...partial } = full;
    expect(isRedisClientInput(partial)).toBe(false);
    expect(redisClientProblem(partial)).toBe('redis.client is missing FrontMcpRedisClient methods: eval');
    expect(redisClientProblem({ ping() {} })).toMatch(/not a Redis client FrontMCP can use/);
    expect(redisClientProblem(full)).toBeUndefined();
  });

  it('recognizes a class from another copy of the package by its shape', () => {
    class OtherCopyRedis {
      status = 'wait';
      isCluster = false;
      call() {}
      duplicate() {}
      sendCommand() {}
    }
    expect(detectRedisClientKind(new OtherCopyRedis())).toBe('ioredis');
  });
});

describe('borrowRedisClient', () => {
  it('keeps every method but the closing ones, run with the client as this', async () => {
    const client = {
      name: 'mine',
      get(this: { name: string }, key: string) {
        return Promise.resolve(`${this.name}:${key}`);
      },
      quit: jest.fn(),
      disconnect: jest.fn(),
      close: jest.fn(),
      destroy: jest.fn(),
    };
    const borrowed = borrowRedisClient(client);
    await expect(borrowed.get('k')).resolves.toBe('mine:k');
    expect(borrowed.name).toBe('mine');
    await expect(borrowed.quit()).resolves.toBe('OK');
    borrowed.disconnect();
    await borrowed.close();
    borrowed.destroy();
    expect(client.quit).not.toHaveBeenCalled();
    expect(client.disconnect).not.toHaveBeenCalled();
    expect(client.close).not.toHaveBeenCalled();
    expect(client.destroy).not.toHaveBeenCalled();
    expect(isBorrowedRedisClient(borrowed)).toBe(true);
    expect(isBorrowedRedisClient(client)).toBe(false);
    expect(isBorrowedRedisClient(null)).toBe(false);
    expect(borrowRedisClient(borrowed)).toBe(borrowed);
  });

  it('leaves a closing method the client lacks undefined', () => {
    const client = { get() {} };
    const borrowed = borrowRedisClient(client) as { quit?: unknown };
    expect(borrowed.quit).toBeUndefined();
  });
});

describe('isRedisConnection', () => {
  it.each([
    ['a host', { host: 'cache' }, true],
    ['a host with provider redis', { provider: 'redis', host: 'cache', port: 6379 }, true],
    ['a url', { url: 'redis://cache' }, true],
    ['cluster seed nodes', { cluster: { nodes: ['a:1'] } }, true],
    ['a client', { client: { get() {} } }, true],
    ['Vercel KV', { provider: 'vercel-kv', url: 'https://kv' }, false],
    ['cluster: true alone', { cluster: true }, false],
    ['empty cluster nodes', { cluster: { nodes: [] } }, false],
    ['an empty host', { host: '' }, false],
    ['a client that is a string', { client: 'redis://x' }, false],
    ['nothing', {}, false],
    ['null', null, false],
  ])('%s -> %p', (_label, value, expected) => {
    expect(isRedisConnection(value)).toBe(expected);
  });
});

describe('redisConnectionOf', () => {
  it('keeps the connection fields only', () => {
    expect(
      redisConnectionOf({
        provider: 'redis',
        host: 'cache',
        port: 6379,
        tls: false,
        cluster: true,
        keyPrefix: 'mcp:',
      } as never),
    ).toEqual({ host: 'cache', port: 6379, tls: false, cluster: true });
  });

  it('gives a client alone', () => {
    const client = { get() {} };
    expect(redisConnectionOf({ client, keyPrefix: 'x' } as never)).toEqual({ client });
  });
});

describe('redisAdapterOptionsOf', () => {
  it('maps each form onto the storage adapter options', () => {
    const client = { get() {} };
    expect(redisAdapterOptionsOf({ client })).toEqual({ client });
    expect(redisAdapterOptionsOf({ url: 'redis://cache', password: 'pw', cluster: true })).toEqual({
      url: 'redis://cache',
      config: { password: 'pw', cluster: true },
    });
    expect(redisAdapterOptionsOf({ host: 'cache', port: 6379, db: 0, tls: false })).toEqual({
      config: { host: 'cache', port: 6379, db: 0, tls: false },
    });
  });
});

describe('publishRedisMessage', () => {
  it('returns what a single node counts', async () => {
    const client = { publish: jest.fn().mockResolvedValue(0) };
    await expect(publishRedisMessage(client, 'ch', 'm')).resolves.toBe(0);
    expect(client.publish).toHaveBeenCalledWith('ch', 'm');
  });

  /** A cluster whose masters are ordered differently on each call, as a topology refresh may. */
  function clusterOf(masters: Array<{ address: string; publish: jest.Mock; pubsub?: jest.Mock }>, all = masters) {
    let flip = false;
    return {
      publish: jest.fn(),
      isCluster: true,
      nodes: jest.fn((role: string) => {
        if (role === 'all') return all;
        flip = !flip;
        return flip ? [...masters] : [...masters].reverse();
      }),
    };
  }

  it('sends every message on a channel through the same master, so they keep their order', async () => {
    const masters = ['10.0.0.2:7000', '10.0.0.1:7000', '10.0.0.3:7000'].map((address) => ({
      address,
      publish: jest.fn().mockResolvedValue(1),
    }));
    const client = clusterOf(masters);
    for (let i = 0; i < 4; i++) await publishRedisMessage(client as never, 'mcp:ha:notify:node-1', `frame ${i}`);

    const used = masters.filter((master) => master.publish.mock.calls.length > 0);
    expect(used).toHaveLength(1);
    expect(used[0].publish.mock.calls.map(([, message]) => message)).toEqual([
      'frame 0',
      'frame 1',
      'frame 2',
      'frame 3',
    ]);
    expect(client.publish).not.toHaveBeenCalled();
  });

  it("counts the channel's subscribers on every node when the cluster's PUBLISH reports none", async () => {
    const master = { address: 'a', publish: jest.fn().mockResolvedValue(0) };
    const all = [
      { address: 'a', publish: jest.fn(), pubsub: jest.fn().mockResolvedValue(['ch', 0]) },
      { address: 'b', publish: jest.fn(), pubsub: jest.fn().mockResolvedValue(['ch', 1]) },
      { address: 'c', publish: jest.fn(), pubsub: jest.fn().mockRejectedValue(new Error('failing over')) },
      { address: 'd', publish: jest.fn() },
    ];
    const client = clusterOf([master], all);
    await expect(publishRedisMessage(client as never, 'ch', 'm')).resolves.toBe(1);
    expect(client.nodes).toHaveBeenCalledWith('all');
    expect(all[1].pubsub).toHaveBeenCalledWith('NUMSUB', 'ch');
  });

  it('orders ioredis node clients by their host and port', async () => {
    const masters = [
      { options: { host: 'b', port: 1 }, publish: jest.fn().mockResolvedValue(1) },
      { options: { host: 'a', port: 1 }, publish: jest.fn().mockResolvedValue(1) },
    ];
    const client = { publish: jest.fn(), isCluster: true, nodes: jest.fn(() => masters) };
    await publishRedisMessage(client as never, 'x', 'm');
    await publishRedisMessage(client as never, 'x', 'm');
    expect(masters.filter((m) => m.publish.mock.calls.length === 2)).toHaveLength(1);
  });
});
