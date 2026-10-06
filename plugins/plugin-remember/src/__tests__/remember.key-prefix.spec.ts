/**
 * The Redis and Vercel KV stores keep Remember's entries under the plugin's `keyPrefix` once (#767).
 * Up to 1.9.1 they added the prefix to keys that already carried it (`remember:remember:v2:…`); those
 * entries are still read, and move to the single-prefix key when they are.
 */
import 'reflect-metadata';

import type { Redis as RedisClient } from 'ioredis';

import type { FrontMcpContext } from '@frontmcp/sdk';

import { RememberAccessor } from '../providers/remember-accessor.provider';
import RememberRedisProvider from '../providers/remember-redis.provider';
import type { RememberStoreInterface } from '../providers/remember-store.interface';
import RememberVercelKvProvider from '../providers/remember-vercel-kv.provider';

class GlobRedisServer {
  readonly entries = new Map<string, string>();
  readonly ttlMs = new Map<string, number>();

  async get(key: string): Promise<string | null> {
    return this.entries.get(key) ?? null;
  }

  async set(key: string, value: string, ...flags: unknown[]): Promise<string | null> {
    const options = flags.find((flag): flag is { px?: number; nx?: boolean } => typeof flag === 'object');
    const onlyIfAbsent = flags.includes('NX') || options?.nx === true;
    if (onlyIfAbsent && this.entries.has(key)) return null;
    this.entries.set(key, value);
    const pxIndex = flags.indexOf('PX');
    const ttlMs = pxIndex >= 0 ? (flags[pxIndex + 1] as number) : options?.px;
    if (ttlMs !== undefined) this.ttlMs.set(key, ttlMs);
    return 'OK';
  }

  async pttl(key: string): Promise<number> {
    if (!this.entries.has(key)) return -2;
    return this.ttlMs.get(key) ?? -1;
  }

  async del(key: string): Promise<number> {
    this.ttlMs.delete(key);
    return this.entries.delete(key) ? 1 : 0;
  }

  async exists(key: string): Promise<number> {
    return this.entries.has(key) ? 1 : 0;
  }

  async keys(match: string): Promise<string[]> {
    const pattern = new RegExp(`^${match.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    return [...this.entries.keys()].filter((key) => pattern.test(key));
  }

  async scan(_cursor: unknown, ...args: unknown[]): Promise<[string, string[]]> {
    const options = args[0];
    const match =
      typeof options === 'object' && options !== null
        ? ((options as { match?: string }).match ?? '*')
        : (args[args.indexOf('MATCH') + 1] as string);
    return ['0', await this.keys(match)];
  }
}

let vercelKvServer = new GlobRedisServer();

jest.mock('@vercel/kv', () => ({
  createClient: () => vercelKvServer,
}));

const context = {
  sessionId: 'session-1',
  authInfo: { sessionId: 'session-1', clientId: 'client-1', extra: { userId: 'nour' } },
  flow: { name: 'tool' },
} as unknown as FrontMcpContext;

function rememberOver(store: RememberStoreInterface): RememberAccessor {
  return new RememberAccessor(store, context, {
    type: 'memory',
    keyPrefix: 'remember:',
    encryption: { enabled: false },
    skipLegacyPurge: true,
  });
}

const stores: Array<[string, () => { server: GlobRedisServer; store: RememberStoreInterface }]> = [
  [
    'RememberRedisProvider',
    () => {
      const server = new GlobRedisServer();
      const client = server as unknown as RedisClient;
      return { server, store: new RememberRedisProvider({ type: 'redis-client', client, keyPrefix: 'remember:' }) };
    },
  ],
  [
    'RememberVercelKvProvider',
    () => {
      vercelKvServer = new GlobRedisServer();
      const store = new RememberVercelKvProvider({
        url: 'https://kv.example.com',
        token: 'token',
        keyPrefix: 'remember:',
      });
      return { server: vercelKvServer, store };
    },
  ],
];

describe.each(stores)('%s keyPrefix', (_name, build) => {
  let server: GlobRedisServer;
  let store: RememberStoreInterface;

  beforeEach(() => {
    ({ server, store } = build());
  });

  it('stores an entry under the prefix once', async () => {
    await rememberOver(store).set('lang', 'he', { scope: 'user' });

    expect([...server.entries.keys()]).toEqual(['remember:v2:user:nour:lang']);
  });

  it('still prefixes a key that does not carry the prefix', async () => {
    await store.setValue('plain', 1);

    expect([...server.entries.keys()]).toEqual(['remember:plain']);
    expect(await store.keys()).toEqual(['plain']);
  });

  it('reads an entry a release up to 1.9.1 stored under the doubled prefix, and moves it with its TTL', async () => {
    const remember = rememberOver(store);
    await remember.set('lang', 'he', { scope: 'user' });
    const [storedText] = [...server.entries.values()];
    server.entries.clear();
    await server.set('remember:remember:v2:user:nour:lang', storedText ?? '', 'PX', 60_000);

    expect(await remember.list({ scope: 'user' })).toEqual(['lang']);
    expect(await remember.get('lang', { scope: 'user' })).toBe('he');
    expect([...server.entries.keys()]).toEqual(['remember:v2:user:nour:lang']);
    expect(await server.pttl('remember:v2:user:nour:lang')).toBe(60_000);
  });

  it('forgets an entry under both keys', async () => {
    await server.set('remember:remember:v2:user:nour:lang', JSON.stringify(JSON.stringify({ value: 'he' })));
    const remember = rememberOver(store);

    await remember.forget('lang', { scope: 'user' });

    expect(server.entries.size).toBe(0);
  });

  it('drops the doubled key when the entry is written again', async () => {
    await server.set('remember:remember:v2:user:nour:lang', JSON.stringify(JSON.stringify({ value: 'old' })));

    await rememberOver(store).set('lang', 'he', { scope: 'user' });

    expect([...server.entries.keys()]).toEqual(['remember:v2:user:nour:lang']);
  });
});
