import type { PeopleAuthOptions } from '@frontmcp/auth';
import {
  createNamespacedStorage,
  createStorage,
  type SqliteAdapterOptions,
  type StorageAdapter,
  type StorageConfig,
} from '@frontmcp/utils';

import { isRedisProvider, redisOptionsSchema, type FrontMcpLogger } from '../common';

export interface PeopleStoreSources {
  /** The server's `redis`. */
  redis?: unknown;
  /** The server's `sqlite`, with its path resolved. */
  sqlite?: SqliteAdapterOptions;
  /** The connected store of a Redis or SQLite `auth.tokenStorage`. */
  tokenStorage?: StorageAdapter;
}

export interface PeopleSessionStore {
  store: StorageAdapter;
  backend: 'redis' | 'sqlite' | 'auth.tokenStorage';
  close(): Promise<void>;
}

function serverRedis(redis: unknown): StorageConfig | undefined {
  const parsed = redis === undefined ? undefined : redisOptionsSchema.safeParse(redis);
  if (!parsed?.success || !isRedisProvider(parsed.data)) return undefined;
  const { host, port, password, db, tls } = parsed.data;
  return { type: 'redis', redis: { config: { host, port, password, db, tls } } };
}

/** Where people sessions are kept: the server's `redis`, else its `sqlite`, else `auth.tokenStorage`; none with `store: false`. */
export function peopleStoreBackend(
  options: Pick<PeopleAuthOptions, 'store'>,
  sources: PeopleStoreSources,
): PeopleSessionStore['backend'] | undefined {
  if (options.store === false) return undefined;
  if (serverRedis(sources.redis)) return 'redis';
  if (sources.sqlite) return 'sqlite';
  return sources.tokenStorage ? 'auth.tokenStorage' : undefined;
}

/**
 * Open the store people sessions are kept in, under `mcp:people:<server name>:` so two servers sharing a store never
 * share a sign-in. A store that cannot be opened is logged and leaves the sessions in memory, as before.
 */
export async function openPeopleSessionStore(
  options: Pick<PeopleAuthOptions, 'store'>,
  sources: PeopleStoreSources,
  serverName: string,
  logger: FrontMcpLogger,
): Promise<PeopleSessionStore | undefined> {
  const backend = peopleStoreBackend(options, sources);
  const prefix = `mcp:people:${serverName}:`;
  if (backend === undefined) {
    if (options.store !== false) {
      logger.warn(
        'http.auth.people keeps sign-in sessions in memory, so a restart signs everyone out: give the server a redis ' +
          "or sqlite store to keep them, or set http.auth.people to { mode: 'loopback-token', store: false } to keep " +
          'them in memory without this warning',
      );
    }
    return undefined;
  }
  if (backend === 'auth.tokenStorage' && sources.tokenStorage) {
    return { store: createNamespacedStorage(sources.tokenStorage, prefix), backend, close: async () => undefined };
  }
  const config = backend === 'redis' ? serverRedis(sources.redis) : { type: 'sqlite' as const, sqlite: sources.sqlite };
  try {
    const storage = await createStorage({ ...config, prefix, fallback: 'error' });
    return { store: storage, backend, close: () => storage.disconnect() };
  } catch (error) {
    logger.warn(
      `http.auth.people: the ${backend} store cannot be opened, so sign-in sessions stay in memory and a restart ` +
        `signs everyone out: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}
