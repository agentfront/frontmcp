/**
 * The cluster-aware helpers: today's call on a single node, per-key or per-master on a cluster (#1503).
 */
import { borrowRedisClient, isBorrowedRedisClient } from '../borrow';
import {
  deleteRedisKeys,
  getRedisKeys,
  isRedisClusterClient,
  redisKeys,
  redisMasterNodes,
  scanRedisKeys,
} from '../cluster-ops';
import { detectRedisClientKind, isRedisClientInput } from '../detect';
import type { FrontMcpRedisClient } from '../types';

/** A node holding `keys`, scanned two at a time. */
function node(keys: string[]) {
  return {
    scan: jest.fn(async (cursor: string) => {
      const start = Number(cursor);
      const next = start + 2 >= keys.length ? '0' : String(start + 2);
      return [next, keys.slice(start, start + 2)] as [string, string[]];
    }),
    keys: jest.fn(async () => keys),
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

describe('redisKeys', () => {
  it('sends one KEYS to a single node', async () => {
    const single = node(['a']);
    await expect(redisKeys(asClient(single), 'p*')).resolves.toEqual(['a']);
    expect(single.keys).toHaveBeenCalledWith('p*');
  });

  it('sends KEYS to every master of a cluster', async () => {
    const masters = [node(['a', 'x']), node(['b', 'x'])];
    await expect(redisKeys(asClient(cluster(masters)), 'p*')).resolves.toEqual(['a', 'x', 'b']);
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
    expect(isRedisClientInput(value)).toBe(kind !== undefined);
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
    const borrowed = borrowRedisClient({ get() {} }) as { quit?: unknown };
    expect(borrowed.quit).toBeUndefined();
  });
});
