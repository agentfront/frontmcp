/**
 * The Redis and Vercel KV stores keep Remember's entries under the plugin's `keyPrefix` once (#767).
 * Up to 1.9.1 they added the prefix to keys that already carried it (`remember:remember:v2:…`); those
 * entries are still read from there, and nothing is copied on read, so a rollback still finds them.
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

  async eval(_script: string, ...args: unknown[]): Promise<number> {
    const [keys, argv] = Array.isArray(args[0])
      ? [args[0] as string[], args[1] as string[]]
      : [args.slice(1, 1 + (args[0] as number)) as string[], args.slice(1 + (args[0] as number)) as string[]];
    this.evalCalls.push(keys);
    if (keys.some((key) => this.entries.has(key))) return 0;
    const [storeKey, value, ttlSeconds] = [keys[0] ?? '', argv[0] ?? '', argv[1] ?? ''];
    this.entries.set(storeKey, value);
    if (ttlSeconds !== '') this.ttlMs.set(storeKey, Number(ttlSeconds) * 1000);
    return 1;
  }

  readonly evalCalls: string[][] = [];

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

  async function storeUnderDoubledPrefix(): Promise<string> {
    const remember = rememberOver(store);
    await remember.set('lang', 'he', { scope: 'user' });
    const [storedText] = [...server.entries.values()];
    server.entries.clear();
    await server.set('remember:remember:v2:user:nour:lang', storedText ?? '', 'PX', 60_000);
    return 'remember:remember:v2:user:nour:lang';
  }

  it('reads an entry a release up to 1.9.1 stored under the doubled prefix, leaving it and its TTL there', async () => {
    const doubledKey = await storeUnderDoubledPrefix();
    const remember = rememberOver(store);

    expect(await remember.list({ scope: 'user' })).toEqual(['lang']);
    expect(await remember.get('lang', { scope: 'user' })).toBe('he');
    expect([...server.entries.keys()]).toEqual([doubledKey]);
    expect(await server.pttl(doubledKey)).toBe(60_000);
  });

  it('does not bring back an entry forgotten while it was being read', async () => {
    const doubledKey = await storeUnderDoubledPrefix();
    const readEntry = server.get.bind(server);
    server.get = async (key: string) => {
      const value = await readEntry(key);
      if (key === doubledKey) await rememberOver(store).forget('lang', { scope: 'user' });
      return value;
    };

    await rememberOver(store).get('lang', { scope: 'user' });

    expect(server.entries.size).toBe(0);
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

  it('does not create a key whose entry still sits under the doubled prefix', async () => {
    const doubledKey = await storeUnderDoubledPrefix();

    expect(await store.setIfAbsent?.('remember:v2:user:nour:lang', 'replacement', 60)).toBe(false);
    expect([...server.entries.keys()]).toEqual([doubledKey]);
    expect(server.evalCalls).toEqual([['remember:v2:user:nour:lang', doubledKey]]);
  });

  it('treats an unreadable value under the doubled prefix as occupying the key', async () => {
    await server.set('remember:remember:__layout__', 'not json');

    expect(await store.setIfAbsent?.('remember:__layout__', 'marker')).toBe(false);
    expect(server.entries.has('remember:__layout__')).toBe(false);
  });

  it('creates the key under the prefix once, with its TTL, when neither key exists', async () => {
    expect(await store.setIfAbsent?.('remember:v2:user:nour:lang', 'he', 60)).toBe(true);

    expect([...server.entries.keys()]).toEqual(['remember:v2:user:nour:lang']);
    expect(await server.pttl('remember:v2:user:nour:lang')).toBe(60_000);
  });
});
