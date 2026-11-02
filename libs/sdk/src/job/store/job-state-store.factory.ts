import { createRedisClient, createStorage, StorageConfigError, type SqliteAdapterOptions } from '@frontmcp/utils';

import { type FrontMcpLogger } from '../../common/interfaces/logger.interface';
import { type JobStateStore } from './job-state.interface';
import { MemoryJobStateStore } from './memory-job-state.store';
import { RedisJobStateStore, type RedisStateStoreLike } from './redis-job-state.store';
import { StorageJobStateStore } from './storage-job-state.store';

export interface JobStateStoreOptions {
  redis?: {
    provider?: string;
    host?: string;
    port?: number;
    url?: string;
    password?: string;
    db?: number;
    tls?: boolean;
  };
  /** A SQLite file the processes on one machine share; takes precedence over `redis`. */
  sqlite?: SqliteAdapterOptions;
  keyPrefix?: string;
  ttlSeconds?: number;
}

export interface JobStateStoreResult {
  store: JobStateStore;
  type: 'redis' | 'memory' | 'sqlite';
}

/**
 * Factory function to create a JobStateStore: SQLite when `sqlite` is set (a mistake in it fails, with no
 * fallback), then Redis, falling back to memory when the Redis client cannot be created.
 */
export async function createJobStateStore(
  options?: JobStateStoreOptions,
  logger?: FrontMcpLogger,
): Promise<JobStateStoreResult> {
  const keyPrefix = options?.keyPrefix ?? 'mcp:jobs:';
  const ttlSeconds = options?.ttlSeconds ?? 86400;

  if (options?.sqlite) {
    const storage = await createStorage({
      type: 'sqlite',
      sqlite: options.sqlite,
      prefix: keyPrefix,
      fallback: 'error',
    });
    return { store: new StorageJobStateStore(storage, ttlSeconds), type: 'sqlite' };
  }

  if (options?.redis) {
    try {
      const { url, host, port, password, db, tls } = options.redis;
      const client = createRedisClient({ url, host, port, password, db, tls, label: 'JobStateStore', logger });
      return {
        store: new RedisJobStateStore(client as unknown as RedisStateStoreLike, logger, keyPrefix, ttlSeconds),
        type: 'redis',
      };
    } catch (err) {
      // A url and a field that contradict each other stop startup, as in every other redis option
      if (err instanceof StorageConfigError) throw err;
      logger?.warn?.(`Failed to create Redis job state store, falling back to memory: ${err}`);
    }
  }

  return {
    store: new MemoryJobStateStore(),
    type: 'memory',
  };
}
