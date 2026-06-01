// --- Subject ---------------------------------------------------------------

import {
  createTokenStorageAdapter,
  isPersistentTokenStorage,
  isRedisTokenStorage,
  isSqliteTokenStorage,
} from '../token-storage.factory';

/**
 * token-storage.factory Tests
 *
 * Covers the config type guards (redis / sqlite / persistent), the persistence
 * helper, and each branch of createTokenStorageAdapter (memory default, sqlite
 * lazy-require, redis). @frontmcp/storage-sqlite is virtually mocked so the
 * suite never pulls in better-sqlite3, and RedisStorageAdapter is stubbed so
 * the redis branch never opens a socket.
 */

// --- Mocks -----------------------------------------------------------------

const connectMemory = jest.fn().mockResolvedValue(undefined);
const connectRedis = jest.fn().mockResolvedValue(undefined);
const MemoryStorageAdapterCtor = jest.fn().mockImplementation(() => ({
  __kind: 'memory',
  connect: connectMemory,
}));
const RedisStorageAdapterCtor = jest.fn().mockImplementation((opts: unknown) => ({
  __kind: 'redis',
  opts,
  connect: connectRedis,
}));

// Provide only the two constructors the factory imports at runtime. Avoid
// `requireActual` so the real storage module (and any background timers/handles
// it might initialize) is never loaded — that previously left a worker hanging.
jest.mock('@frontmcp/utils', () => ({
  MemoryStorageAdapter: MemoryStorageAdapterCtor,
  RedisStorageAdapter: RedisStorageAdapterCtor,
}));

const connectSqlite = jest.fn().mockResolvedValue(undefined);
const SqliteStorageAdapterCtor = jest.fn().mockImplementation((opts: unknown) => ({
  __kind: 'sqlite',
  opts,
  connect: connectSqlite,
}));

jest.mock(
  '@frontmcp/storage-sqlite',
  () => ({
    SqliteStorageAdapter: SqliteStorageAdapterCtor,
  }),
  { virtual: true },
);

describe('token-storage.factory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isRedisTokenStorage', () => {
    it('returns true for a redis config', () => {
      expect(isRedisTokenStorage({ redis: { host: 'localhost' } })).toBe(true);
    });
    it('returns false for memory / undefined / sqlite', () => {
      expect(isRedisTokenStorage('memory')).toBe(false);
      expect(isRedisTokenStorage(undefined)).toBe(false);
      expect(isRedisTokenStorage({ sqlite: { path: '/tmp/a.sqlite' } })).toBe(false);
    });
  });

  describe('isSqliteTokenStorage', () => {
    it('returns true for a sqlite config', () => {
      expect(isSqliteTokenStorage({ sqlite: { path: '/tmp/a.sqlite' } })).toBe(true);
    });
    it('returns false for memory / undefined / redis', () => {
      expect(isSqliteTokenStorage('memory')).toBe(false);
      expect(isSqliteTokenStorage(undefined)).toBe(false);
      expect(isSqliteTokenStorage({ redis: { host: 'localhost' } })).toBe(false);
    });
  });

  describe('isPersistentTokenStorage', () => {
    it('treats undefined and "memory" as non-persistent', () => {
      expect(isPersistentTokenStorage(undefined)).toBe(false);
      expect(isPersistentTokenStorage('memory')).toBe(false);
    });
    it('treats redis and sqlite as persistent', () => {
      expect(isPersistentTokenStorage({ redis: { host: 'localhost' } })).toBe(true);
      expect(isPersistentTokenStorage({ sqlite: { path: '/tmp/a.sqlite' } })).toBe(true);
    });
  });

  describe('createTokenStorageAdapter', () => {
    it('returns a connected memory adapter for undefined config', async () => {
      const adapter = (await createTokenStorageAdapter(undefined)) as unknown as { __kind: string };
      expect(adapter.__kind).toBe('memory');
      expect(MemoryStorageAdapterCtor).toHaveBeenCalledTimes(1);
      expect(connectMemory).toHaveBeenCalledTimes(1);
    });

    it('returns a connected memory adapter for the "memory" literal', async () => {
      const adapter = (await createTokenStorageAdapter('memory')) as unknown as { __kind: string };
      expect(adapter.__kind).toBe('memory');
      expect(connectMemory).toHaveBeenCalledTimes(1);
    });

    it('lazy-loads and connects a SQLite adapter, forwarding options', async () => {
      const adapter = (await createTokenStorageAdapter({
        sqlite: {
          path: '/tmp/auth.sqlite',
          encryption: { secret: 's3cr3t' },
          ttlCleanupIntervalMs: 30000,
          walMode: false,
        },
      })) as unknown as { __kind: string };

      expect(adapter.__kind).toBe('sqlite');
      expect(SqliteStorageAdapterCtor).toHaveBeenCalledWith({
        path: '/tmp/auth.sqlite',
        encryption: { secret: 's3cr3t' },
        ttlCleanupIntervalMs: 30000,
        walMode: false,
      });
      expect(connectSqlite).toHaveBeenCalledTimes(1);
    });

    it('applies SQLite defaults (ttlCleanupIntervalMs / walMode) when omitted', async () => {
      await createTokenStorageAdapter({ sqlite: { path: '/tmp/auth.sqlite' } });
      expect(SqliteStorageAdapterCtor).toHaveBeenCalledWith({
        path: '/tmp/auth.sqlite',
        encryption: undefined,
        ttlCleanupIntervalMs: 60000,
        walMode: true,
      });
    });

    it('builds and connects a Redis adapter, forwarding connection options', async () => {
      const adapter = (await createTokenStorageAdapter({
        redis: { host: 'redis.example.com', port: 6380, password: 'pw', db: 2, tls: true, keyPrefix: 'auth:' },
      })) as unknown as { __kind: string; opts: { config: unknown; keyPrefix: string } };

      expect(adapter.__kind).toBe('redis');
      expect(RedisStorageAdapterCtor).toHaveBeenCalledWith({
        config: { host: 'redis.example.com', port: 6380, password: 'pw', db: 2, tls: true },
        keyPrefix: 'auth:',
      });
      expect(connectRedis).toHaveBeenCalledTimes(1);
    });

    it('defaults the Redis keyPrefix to an empty string', async () => {
      await createTokenStorageAdapter({ redis: { host: 'localhost' } });
      expect(RedisStorageAdapterCtor).toHaveBeenCalledWith({
        config: { host: 'localhost', port: undefined, password: undefined, db: undefined, tls: undefined },
        keyPrefix: '',
      });
    });
  });
});
