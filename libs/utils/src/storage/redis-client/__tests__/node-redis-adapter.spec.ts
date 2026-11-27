/**
 * NodeRedisClientAdapter: node-redis behind the FrontMcpRedisClient interface (#1503).
 */
import { NodeRedisClientAdapter, type NodeRedisLike } from '../node-redis-adapter';

type Listener = (message: string, channel: string) => void;

function fakeNodeRedis(overrides: Partial<Record<string, unknown>> = {}) {
  const state = { isOpen: false };
  const subscriptions = new Map<string, Listener>();
  const client = {
    get isOpen() {
      return state.isOpen;
    },
    connect: jest.fn(async () => {
      state.isOpen = true;
    }),
    sendCommand: jest.fn(async (..._args: unknown[]): Promise<unknown> => 'OK'),
    duplicate: jest.fn(),
    subscribe: jest.fn(async (channels: string[], listener: Listener) => {
      for (const channel of channels) subscriptions.set(channel, listener);
    }),
    unsubscribe: jest.fn(async (channels: string[]) => {
      for (const channel of channels) subscriptions.delete(channel);
    }),
    on: jest.fn(),
    removeListener: jest.fn(),
    close: jest.fn(async () => {
      state.isOpen = false;
    }),
    destroy: jest.fn(),
    ...overrides,
  };
  return { client, state, subscriptions };
}

describe('NodeRedisClientAdapter on a client', () => {
  it('connects once, on first use, even for concurrent commands', async () => {
    const { client } = fakeNodeRedis();
    const adapter = new NodeRedisClientAdapter(client as unknown as NodeRedisLike, { cluster: false, owned: false });
    await Promise.all([adapter.get('a'), adapter.get('b'), adapter.connect()]);
    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  it('leaves an open client as it is', async () => {
    const { client, state } = fakeNodeRedis();
    state.isOpen = true;
    await new NodeRedisClientAdapter(client as unknown as NodeRedisLike, { cluster: false, owned: false }).ping();
    expect(client.connect).not.toHaveBeenCalled();
  });

  it.each([
    ['get', ['k'], ['GET', 'k'], 'v'],
    ['set', ['k', 'v', 'EX', 60, 'NX'], ['SET', 'k', 'v', 'EX', '60', 'NX'], 'OK'],
    ['setex', ['k', 30, 'v'], ['SETEX', 'k', '30', 'v'], 'OK'],
    ['getex', ['k', 'EX', 30], ['GETEX', 'k', 'EX', '30'], 'v'],
    ['del', ['a', 'b'], ['DEL', 'a', 'b'], 2],
    ['exists', ['a'], ['EXISTS', 'a'], 1],
    ['expire', ['a', 9], ['EXPIRE', 'a', '9'], 1],
    ['ttl', ['a'], ['TTL', 'a'], 42],
    ['incr', ['a'], ['INCR', 'a'], 1],
    ['decr', ['a'], ['DECR', 'a'], 0],
    ['incrby', ['a', 5], ['INCRBY', 'a', '5'], 5],
    ['mget', ['a', 'b'], ['MGET', 'a', 'b'], ['1', null]],
    ['eval', ['return 1', 1, 'k', 'arg'], ['EVAL', 'return 1', '1', 'k', 'arg'], 1],
    ['sadd', ['s', 'm'], ['SADD', 's', 'm'], 1],
    ['srem', ['s', 'm'], ['SREM', 's', 'm'], 1],
    ['smembers', ['s'], ['SMEMBERS', 's'], ['m']],
    ['xadd', ['st', 'MAXLEN', '~', 10, '*', 'msg', '{}'], ['XADD', 'st', 'MAXLEN', '~', '10', '*', 'msg', '{}'], '1-0'],
    ['xrange', ['st', '(1-0', '+'], ['XRANGE', 'st', '(1-0', '+'], [['2-0', ['msg', '{}']]]],
    ['publish', ['ch', 'hi'], ['PUBLISH', 'ch', 'hi'], 1],
    ['ping', [], ['PING'], 'PONG'],
  ])('%s sends %p', async (method, args, command, reply) => {
    const { client } = fakeNodeRedis();
    client.sendCommand.mockResolvedValue(reply);
    const adapter = new NodeRedisClientAdapter(client as unknown as NodeRedisLike, { cluster: false, owned: false });
    const result = await (adapter as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method](...args);
    expect(client.sendCommand).toHaveBeenCalledWith(command);
    expect(result).toEqual(reply);
  });

  it('returns SCAN as ioredis does', async () => {
    const { client } = fakeNodeRedis();
    client.sendCommand.mockResolvedValue([5, ['a', 'b']]);
    const adapter = new NodeRedisClientAdapter(client as unknown as NodeRedisLike, { cluster: false, owned: false });
    await expect(adapter.scan('0', 'MATCH', '*', 'COUNT', 100)).resolves.toEqual(['5', ['a', 'b']]);
    expect(client.sendCommand).toHaveBeenCalledWith(['SCAN', '0', 'MATCH', '*', 'COUNT', '100']);
  });

  it.each([
    ['a RESP2 array', ['f1', 'v1', 'f2', 'v2']],
    [
      'a RESP3 map',
      new Map([
        ['f1', 'v1'],
        ['f2', 'v2'],
      ]),
    ],
    ['an object', { f1: 'v1', f2: 'v2' }],
  ])('returns HGETALL from %s as an object', async (_label, reply) => {
    const { client } = fakeNodeRedis();
    client.sendCommand.mockResolvedValue(reply);
    const adapter = new NodeRedisClientAdapter(client as unknown as NodeRedisLike, { cluster: false, owned: false });
    await expect(adapter.hgetall('h')).resolves.toEqual({ f1: 'v1', f2: 'v2' });
  });

  it('returns an empty object for a missing hash', async () => {
    const { client } = fakeNodeRedis();
    client.sendCommand.mockResolvedValue(null);
    const adapter = new NodeRedisClientAdapter(client as unknown as NodeRedisLike, { cluster: false, owned: false });
    await expect(adapter.hgetall('h')).resolves.toEqual({});
  });

  it('delivers subscribed messages as ioredis does: (channel, message)', async () => {
    const { client, subscriptions } = fakeNodeRedis();
    const adapter = new NodeRedisClientAdapter(client as unknown as NodeRedisLike, { cluster: false, owned: true });
    const received: Array<[string, string]> = [];
    const listener = (channel: string, message: string) => received.push([channel, message]);
    adapter.on('message', listener);
    await adapter.subscribe('ch');
    subscriptions.get('ch')?.('hello', 'ch');
    adapter.removeListener('message', listener);
    subscriptions.get('ch')?.('ignored', 'ch');
    await adapter.unsubscribe('ch');
    expect(received).toEqual([['ch', 'hello']]);
    expect(subscriptions.size).toBe(0);
  });

  it('passes other events to the client', () => {
    const { client } = fakeNodeRedis();
    const adapter = new NodeRedisClientAdapter(client as unknown as NodeRedisLike, { cluster: false, owned: true });
    const listener = jest.fn();
    adapter.on('error', listener);
    adapter.removeListener('error', listener);
    expect(client.on).toHaveBeenCalledWith('error', listener);
    expect(client.removeListener).toHaveBeenCalledWith('error', listener);
  });

  it('falls back to off() when the client has no removeListener', () => {
    const { client } = fakeNodeRedis({ removeListener: undefined, off: jest.fn() });
    const adapter = new NodeRedisClientAdapter(client as unknown as NodeRedisLike, { cluster: false, owned: true });
    const listener = jest.fn();
    adapter.removeListener('error', listener);
    expect((client as unknown as { off: jest.Mock }).off).toHaveBeenCalledWith('error', listener);
  });

  it('never closes a client it was given', async () => {
    const { client, state } = fakeNodeRedis();
    state.isOpen = true;
    const adapter = new NodeRedisClientAdapter(client as unknown as NodeRedisLike, { cluster: false, owned: false });
    await adapter.quit();
    adapter.disconnect();
    expect(client.close).not.toHaveBeenCalled();
    expect(client.destroy).not.toHaveBeenCalled();
  });

  it('closes a copy it made: close()/destroy() on v5+, quit()/disconnect() on v4', async () => {
    const v6 = fakeNodeRedis();
    const v4 = fakeNodeRedis({
      close: undefined,
      destroy: undefined,
      quit: jest.fn(),
      disconnect: jest.fn(async () => undefined),
    });
    v6.client.duplicate.mockReturnValue(v6.client);
    v4.client.duplicate.mockReturnValue(v4.client);
    for (const { client, state } of [v6, v4]) {
      const original = new NodeRedisClientAdapter(client as unknown as NodeRedisLike, { cluster: false, owned: false });
      const copy = original.duplicate();
      await copy.ping();
      state.isOpen = true;
      await copy.quit();
      copy.disconnect();
    }
    expect(v6.client.close).toHaveBeenCalled();
    expect(v6.client.destroy).toHaveBeenCalled();
    expect((v4.client as unknown as { quit: jest.Mock }).quit).toHaveBeenCalled();
    expect((v4.client as unknown as { disconnect: jest.Mock }).disconnect).toHaveBeenCalled();
  });

  it('does not close a copy that is already closed', async () => {
    const { client } = fakeNodeRedis();
    client.duplicate.mockReturnValue(client);
    const copy = new NodeRedisClientAdapter(client as unknown as NodeRedisLike, {
      cluster: false,
      owned: false,
    }).duplicate();
    await copy.quit();
    expect(client.close).not.toHaveBeenCalled();
  });

  it('pipelines SETs and reports each outcome as [error, result]', async () => {
    const { client, state } = fakeNodeRedis();
    state.isOpen = true;
    client.sendCommand.mockImplementation(async (...args: unknown[]) => {
      const [, key] = args[0] as string[];
      if (key === 'b') throw new Error('nope');
      if (key === 'c') throw 'raw';
      return 'OK';
    });
    const adapter = new NodeRedisClientAdapter(client as unknown as NodeRedisLike, { cluster: false, owned: false });
    const pipeline = adapter.pipeline();
    pipeline.set('a', '1').set('b', '2', 'EX', 5).set('c', '3');
    const results = await pipeline.exec();
    expect(results?.[0]).toEqual([null, 'OK']);
    expect(results?.[1][0]).toBeInstanceOf(Error);
    expect(results?.[2][0]?.message).toBe('raw');
  });

  it('is not a cluster and has no masters', () => {
    const { client } = fakeNodeRedis();
    const adapter = new NodeRedisClientAdapter(client as unknown as NodeRedisLike, { cluster: false, owned: false });
    expect(adapter.isCluster).toBe(false);
    expect(adapter.nodes()).toEqual([]);
  });
});

describe('NodeRedisClientAdapter on a cluster', () => {
  it('routes a command by its first key (eval by its first KEYS entry)', async () => {
    const { client } = fakeNodeRedis({ masters: [], nodeClient: jest.fn() });
    const adapter = new NodeRedisClientAdapter(client as unknown as NodeRedisLike, { cluster: true, owned: false });
    await adapter.get('k1');
    await adapter.set('k2', 'v');
    await adapter.eval('return 1', 1, 'k3', 'arg');
    await adapter.eval('return 1', 0);
    await adapter.publish('ch', 'm');
    await adapter.scan('0');
    expect(client.sendCommand.mock.calls).toEqual([
      ['k1', true, ['GET', 'k1']],
      ['k2', false, ['SET', 'k2', 'v']],
      ['k3', false, ['EVAL', 'return 1', '1', 'k3', 'arg']],
      [undefined, false, ['EVAL', 'return 1', '0']],
      [undefined, false, ['PUBLISH', 'ch', 'm']],
      [undefined, true, ['SCAN', '0']],
    ]);
  });

  it('lists each master as a client of its own, resolved through nodeClient()', async () => {
    const node = fakeNodeRedis();
    node.state.isOpen = true;
    node.client.sendCommand.mockResolvedValue(['0', ['x']]);
    const nodeClient = jest.fn(async () => node.client);
    const { client } = fakeNodeRedis({ masters: [{ id: 'm1' }, { id: 'm2' }], nodeClient });
    const adapter = new NodeRedisClientAdapter(client as unknown as NodeRedisLike, { cluster: true, owned: false });
    const masters = adapter.nodes();
    expect(masters).toHaveLength(2);
    await expect(masters[0].scan('0')).resolves.toEqual(['0', ['x']]);
    expect(nodeClient).toHaveBeenCalledWith({ id: 'm1' });
    expect(node.client.sendCommand).toHaveBeenCalledWith(['SCAN', '0']);
    // The cluster owns its node clients
    await masters[0].quit();
    expect(node.client.close).not.toHaveBeenCalled();
    expect(() => masters[1].duplicate()).toThrow(/cannot be duplicated/);
  });

  it('duplicates the cluster as a cluster it owns', async () => {
    const copy = fakeNodeRedis({ masters: [], nodeClient: jest.fn() });
    const { client } = fakeNodeRedis({ masters: [], nodeClient: jest.fn() });
    client.duplicate.mockReturnValue(copy.client);
    const duplicated = new NodeRedisClientAdapter(client as unknown as NodeRedisLike, {
      cluster: true,
      owned: false,
    }).duplicate();
    expect(duplicated.isCluster).toBe(true);
    await duplicated.ping();
    await duplicated.quit();
    expect(copy.client.close).toHaveBeenCalled();
  });
});
