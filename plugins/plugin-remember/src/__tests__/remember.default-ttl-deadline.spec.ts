import 'reflect-metadata';

import type { Redis as RedisClient } from 'ioredis';

import type { FrontMcpContext } from '@frontmcp/sdk';

import { RememberAccessor } from '../providers/remember-accessor.provider';
import RememberMemoryProvider from '../providers/remember-memory.provider';
import RememberRedisProvider from '../providers/remember-redis.provider';
import { RememberStorageProvider } from '../providers/remember-storage.provider';
import type { RememberStoreInterface } from '../providers/remember-store.interface';
import type { RememberPluginOptions } from '../remember.types';

const DEFAULT_TTL_SECONDS = 60;

class ExpiringRedisServer {
  private readonly entries = new Map<string, { value: string; expiresAt?: number }>();

  async get(key: string): Promise<string | null> {
    return this.liveEntry(key)?.value ?? null;
  }

  async set(key: string, value: string, ...flags: Array<string | number>): Promise<string> {
    const expiryFlagIndex = flags.indexOf('EX');
    const expirySeconds = expiryFlagIndex >= 0 ? Number(flags[expiryFlagIndex + 1]) : undefined;
    const expiresAt = expirySeconds === undefined ? undefined : Date.now() + expirySeconds * 1000;
    this.entries.set(key, { value, expiresAt });
    return 'OK';
  }

  async del(key: string): Promise<number> {
    return this.entries.delete(key) ? 1 : 0;
  }

  async exists(key: string): Promise<number> {
    return this.liveEntry(key) ? 1 : 0;
  }

  async scan(_cursor: string, _match: string, pattern: string): Promise<[string, string[]]> {
    const prefix = pattern.replace(/\*$/, '');
    const liveKeys = [...this.entries.keys()].filter((key) => key.startsWith(prefix) && this.liveEntry(key));
    return ['0', liveKeys];
  }

  private liveEntry(key: string): { value: string; expiresAt?: number } | undefined {
    const entry = this.entries.get(key);
    if (entry?.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }
}

type StoreKind = 'memory' | 'redis' | 'storage';

async function createStore(kind: StoreKind): Promise<RememberStoreInterface> {
  switch (kind) {
    case 'memory':
      return new RememberMemoryProvider(undefined, DEFAULT_TTL_SECONDS);
    case 'redis':
      return new RememberRedisProvider({
        type: 'redis-client',
        client: new ExpiringRedisServer() as unknown as RedisClient,
        defaultTTL: DEFAULT_TTL_SECONDS,
      });
    case 'storage': {
      const storageStore = new RememberStorageProvider({
        storage: { type: 'memory' },
        defaultTTLSeconds: DEFAULT_TTL_SECONDS,
      });
      await storageStore.initialize();
      return storageStore;
    }
  }
}

function sessionContext(): FrontMcpContext {
  return {
    sessionId: 'session-default-ttl',
    authInfo: { sessionId: 'session-default-ttl', clientId: 'caller', extra: { sub: 'caller' } },
  } as unknown as FrontMcpContext;
}

function configWith(encrypted: boolean, defaultTTL?: number): RememberPluginOptions {
  return {
    type: 'memory',
    keyPrefix: 'remember:',
    encryption: { enabled: encrypted },
    skipLegacyPurge: true,
    defaultTTL,
  };
}

describe.each<[StoreKind, boolean]>([
  ['memory', false],
  ['memory', true],
  ['redis', false],
  ['redis', true],
  ['storage', false],
  ['storage', true],
])('an entry stored under defaultTTL in the %s store, encryption %p (#717)', (kind, encrypted) => {
  let start: number;
  let now: number;
  let store: RememberStoreInterface;
  let remember: RememberAccessor;

  beforeEach(async () => {
    start = Date.now();
    now = start;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    store = await createStore(kind);
    remember = new RememberAccessor(store, sessionContext(), configWith(encrypted, DEFAULT_TTL_SECONDS));
  });

  afterEach(async () => {
    await store.close();
    jest.restoreAllMocks();
  });

  it('records its deadline, and keeps it across an update without a ttl', async () => {
    const deadline = start + DEFAULT_TTL_SECONDS * 1000;
    await remember.set('draft', 'v1');
    expect((await remember.getEntry('draft'))?.expiresAt).toBe(deadline);

    now += 59_000;
    await remember.update('draft', 'v2');

    expect((await remember.getEntry('draft'))?.expiresAt).toBe(deadline);
  });

  it('returns the entry it stored from set(), deadline included', async () => {
    const stored = await remember.set('draft', 'v1', { brand: 'state' });

    expect(stored).toEqual(await remember.getEntry('draft'));
    expect(stored.expiresAt).toBe(start + DEFAULT_TTL_SECONDS * 1000);
  });

  it('expires at its first deadline when updated without a ttl, not a full defaultTTL later', async () => {
    await remember.set('draft', 'v1');
    now += 59_000;
    await expect(remember.update('draft', 'v2')).resolves.toBe(true);

    now += 2_000;

    await expect(store.keys('remember:*')).resolves.toEqual([]);
    await expect(remember.knows('draft')).resolves.toBe(false);
    await expect(remember.list()).resolves.toEqual([]);
    await expect(remember.get('draft')).resolves.toBeUndefined();
  });

  it('writes the whole seconds left until the deadline as the store ttl, rounded up', async () => {
    const setValue = jest.spyOn(store, 'setValue');
    await remember.set('draft', 'v1');
    expect(setValue).toHaveBeenLastCalledWith(expect.any(String), expect.any(String), DEFAULT_TTL_SECONDS);

    now += 30_500;
    await remember.update('draft', 'v2');

    expect(setValue).toHaveBeenLastCalledWith(expect.any(String), expect.any(String), 30);
  });

  it('gives an entry less than a second from its deadline a one-second store ttl, and stops reading it at the deadline', async () => {
    const setValue = jest.spyOn(store, 'setValue');
    await remember.set('draft', 'v1');
    now += 59_600;
    await remember.update('draft', 'v2');

    expect(setValue).toHaveBeenLastCalledWith(expect.any(String), expect.any(String), 1);

    now += 300;
    await expect(remember.get('draft')).resolves.toBe('v2');

    now += 200;
    await expect(store.keys('remember:*')).resolves.toHaveLength(1);
    await expect(remember.knows('draft')).resolves.toBe(false);
    await expect(remember.get('draft')).resolves.toBeUndefined();
  });

  it('refuses to update it once its deadline has passed, and writes nothing', async () => {
    await remember.set('draft', 'v1');
    now += 59_600;
    await remember.update('draft', 'v2');
    const setValue = jest.spyOn(store, 'setValue');

    now += 700;

    await expect(remember.update('draft', 'v3')).resolves.toBe(false);
    expect(setValue).not.toHaveBeenCalled();
    await expect(store.keys('remember:*')).resolves.toEqual([]);
  });

  it('lets an explicit ttl replace the default deadline', async () => {
    await remember.set('draft', 'v1', { ttl: 10 });
    expect((await remember.getEntry('draft'))?.expiresAt).toBe(start + 10_000);

    now += 9_000;
    await remember.update('draft', 'v2', { ttl: 120 });

    expect((await remember.getEntry('draft'))?.expiresAt).toBe(now + 120_000);
    now += 119_000;
    await expect(remember.get('draft')).resolves.toBe('v2');
  });

  it('reads an entry stored without a deadline, and gives it defaultTTL from its next update without a ttl', async () => {
    const withoutDefaultTTL = new RememberAccessor(store, sessionContext(), configWith(encrypted));
    await withoutDefaultTTL.set('draft', 'v1');

    expect((await remember.getEntry('draft'))?.expiresAt).toBeUndefined();
    await expect(remember.get('draft')).resolves.toBe('v1');

    now += 10_000;
    await remember.update('draft', 'v2');
    const deadline = now + DEFAULT_TTL_SECONDS * 1000;
    expect((await remember.getEntry('draft'))?.expiresAt).toBe(deadline);

    now += 59_000;
    await remember.update('draft', 'v3');
    expect((await remember.getEntry('draft'))?.expiresAt).toBe(deadline);

    now += 2_000;
    await expect(store.keys('remember:*')).resolves.toEqual([]);
    await expect(remember.get('draft')).resolves.toBeUndefined();
  });
});

describe('an entry stored without defaultTTL or a ttl', () => {
  it.each([false, true])('records no deadline and keeps none when updated (encryption %p)', async (encrypted) => {
    const store = new RememberMemoryProvider();
    const remember = new RememberAccessor(store, sessionContext(), configWith(encrypted));

    await remember.set('draft', 'v1');
    expect((await remember.getEntry('draft'))?.expiresAt).toBeUndefined();

    await remember.update('draft', 'v2');
    expect((await remember.getEntry('draft'))?.expiresAt).toBeUndefined();
    await store.close();
  });
});
