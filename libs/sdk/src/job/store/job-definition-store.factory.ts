import { createRedisClient, createStorage, StorageConfigError, type SqliteAdapterOptions } from '@frontmcp/utils';

import { type FrontMcpLogger } from '../../common/interfaces/logger.interface';
import { type JobDefinitionStore } from './job-definition.interface';
import { refuseVercelKvJobStore } from './job-state-store.factory';
import { MemoryJobDefinitionStore } from './memory-job-definition.store';
import { RedisJobDefinitionStore } from './redis-job-definition.store';
import { StorageJobDefinitionStore } from './storage-job-definition.store';

/* istanbul ignore next -- no-op fallback used only when caller omits logger */
const noopFn = () => {};
const noopLogger = {
  child: () => noopLogger,
  get verbose() {
    return noopFn;
  },
  get debug() {
    return noopFn;
  },
  get info() {
    return noopFn;
  },
  get warn() {
    return noopFn;
  },
  get error() {
    return noopFn;
  },
} as unknown as FrontMcpLogger;

export interface JobDefinitionStoreOptions {
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
}

export interface JobDefinitionStoreResult {
  store: JobDefinitionStore;
  type: 'redis' | 'memory' | 'sqlite';
}

/**
 * Factory function to create a JobDefinitionStore: SQLite when `sqlite` is set (a mistake in it fails,
 * with no fallback), then Redis, falling back to memory when the Redis client cannot be created.
 */
export async function createJobDefinitionStore(
  options?: JobDefinitionStoreOptions,
  logger?: FrontMcpLogger,
): Promise<JobDefinitionStoreResult> {
  const keyPrefix = options?.keyPrefix ?? 'mcp:jobs:def:';
  const effectiveLogger = logger ?? noopLogger;

  if (options?.sqlite) {
    const storage = await createStorage({
      type: 'sqlite',
      sqlite: options.sqlite,
      prefix: keyPrefix,
      fallback: 'error',
    });
    return { store: new StorageJobDefinitionStore(storage), type: 'sqlite' };
  }

  if (options?.redis) {
    refuseVercelKvJobStore(options.redis);
    try {
      const { url, host, port, password, db, tls } = options.redis;
      const client = createRedisClient({
        url,
        host,
        port,
        password,
        db,
        tls,
        label: 'JobDefinitionStore',
        logger: effectiveLogger,
      });
      return {
        // Factory-created client lifetime is bound to the store, so the store
        // must close it on dispose() — pass ownsClient: true.
        store: new RedisJobDefinitionStore(client, effectiveLogger, keyPrefix, { ownsClient: true }),
        type: 'redis',
      };
    } catch (err) {
      // A url and a field that contradict each other stop startup, as in every other redis option
      if (err instanceof StorageConfigError) throw err;
      effectiveLogger.warn(`Failed to create Redis job definition store, falling back to memory: ${err}`);
    }
  }

  return {
    store: new MemoryJobDefinitionStore(),
    type: 'memory',
  };
}
