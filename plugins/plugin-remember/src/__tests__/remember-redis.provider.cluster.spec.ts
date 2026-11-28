/**
 * RememberRedisProvider on a Redis Cluster (#1503): the key and its pre-1.9.2 doubled-prefix twin
 * live in different hash slots, so the one script that checks both is split; keys() scans every master.
 */
import 'reflect-metadata';

import RememberRedisProvider from '../providers/remember-redis.provider';
import RememberPlugin from '../remember.plugin';

const mockClusterInstance = { on: jest.fn(), once: jest.fn() };
const MockCluster = jest.fn((..._args: unknown[]) => mockClusterInstance);

jest.mock('ioredis', () => {
  class Redis {
    static Cluster = class {
      constructor(...args: unknown[]) {
        return MockCluster(...args);
      }
    };
  }
  return { __esModule: true, default: Redis };
});

function master(keys: string[]) {
  return { scan: jest.fn().mockResolvedValue(['0', keys]) };
}

function clusterClient(masters = [master([]), master([])]) {
  return {
    status: 'ready',
    isCluster: true,
    call: jest.fn(),
    sendCommand: jest.fn(),
    duplicate: jest.fn(),
    nodes: jest.fn(() => masters),
    ping: jest.fn().mockResolvedValue('PONG'),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    exists: jest.fn().mockResolvedValue(0),
    eval: jest.fn(),
    scan: jest.fn(),
    quit: jest.fn(),
    on: jest.fn(),
  };
}

const prefix = 'remember:';

describe('RememberRedisProvider on a cluster', () => {
  it('checks the legacy doubled key, then sets the key if absent, without a 2-key script', async () => {
    const client = clusterClient();
    const provider = new RememberRedisProvider({ type: 'redis-client', client: client as never, keyPrefix: prefix });

    await expect(provider.setIfAbsent(`${prefix}v2:user:a`, { n: 1 }, 30)).resolves.toBe(true);

    expect(client.eval).not.toHaveBeenCalled();
    expect(client.exists).toHaveBeenCalledWith(`${prefix}${prefix}v2:user:a`);
    expect(client.set).toHaveBeenCalledWith(`${prefix}v2:user:a`, '{"n":1}', 'EX', 30, 'NX');
  });

  it('leaves the key alone while a legacy entry is still there', async () => {
    const client = clusterClient();
    client.exists.mockResolvedValue(1);
    const provider = new RememberRedisProvider({ type: 'redis-client', client: client as never, keyPrefix: prefix });

    await expect(provider.setIfAbsent(`${prefix}v2:user:a`, 'x')).resolves.toBe(false);
    expect(client.set).not.toHaveBeenCalled();
  });

  it('reports a key that already exists as not set', async () => {
    const client = clusterClient();
    client.set.mockResolvedValue(null);
    const provider = new RememberRedisProvider({ type: 'redis-client', client: client as never, keyPrefix: prefix });

    await expect(provider.setIfAbsent(`${prefix}v2:user:a`, 'x')).resolves.toBe(false);
  });

  it('keeps the one script on a single node', async () => {
    const client = { ...clusterClient(), isCluster: false, eval: jest.fn().mockResolvedValue(1) };
    const provider = new RememberRedisProvider({ type: 'redis-client', client: client as never, keyPrefix: prefix });

    await expect(provider.setIfAbsent(`${prefix}v2:user:a`, 'x')).resolves.toBe(true);
    expect(client.eval).toHaveBeenCalledWith(
      expect.any(String),
      2,
      `${prefix}v2:user:a`,
      `${prefix}${prefix}v2:user:a`,
      '"x"',
      '',
    );
  });

  it('lists keys from every master', async () => {
    const client = clusterClient([master([`${prefix}a`]), master([`${prefix}b`])]);
    const provider = new RememberRedisProvider({ type: 'redis-client', client: client as never, keyPrefix: prefix });

    await expect(provider.keys('*')).resolves.toEqual(['a', 'b']);
    expect(client.scan).not.toHaveBeenCalled();
  });

  it("never closes the app's client", async () => {
    const client = clusterClient();
    const provider = new RememberRedisProvider({ type: 'redis-client', client: client as never });

    await provider.close();
    expect(client.quit).not.toHaveBeenCalled();
  });
});

describe('RememberPlugin global-store on a cluster named by rediss:// seeds', () => {
  it('keeps the TLS the seeds ask for when the server redis says tls: false', () => {
    const provider = (RememberPlugin.dynamicProviders({ type: 'global-store' }) as unknown[]).find(
      (entry) => (entry as { name?: string }).name === 'remember:store:global',
    ) as { useFactory: (config: unknown) => unknown };
    provider.useFactory({
      redis: {
        provider: 'redis',
        host: 'seed.example',
        port: 6379,
        db: 0,
        tls: false,
        keyPrefix: 'mcp:',
        defaultTtlMs: 3_600_000,
        cluster: { nodes: ['rediss://:secret@seed.example:6379'] },
      },
    });

    expect(MockCluster).toHaveBeenCalledWith(
      [{ host: 'seed.example', port: 6379 }],
      expect.objectContaining({ redisOptions: expect.objectContaining({ password: 'secret', tls: {} }) }),
    );
  });
});
