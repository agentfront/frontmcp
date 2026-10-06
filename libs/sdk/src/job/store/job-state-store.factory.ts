import { createRedisClient, StorageConfigError } from '@frontmcp/utils';

import { type FrontMcpLogger } from '../../common/interfaces/logger.interface';
import { type JobStateStore } from './job-state.interface';
import { MemoryJobStateStore } from './memory-job-state.store';

export interface JobStateStoreOptions {
  redis?: {
    provider: string;
    host?: string;
    port?: number;
    url?: string;
    password?: string;
    db?: number;
    tls?: boolean;
    [key: string]: unknown;
  };
  keyPrefix?: string;
  ttlSeconds?: number;
}

export interface JobStateStoreResult {
  store: JobStateStore;
  type: 'redis' | 'memory';
}

/**
 * Factory function to create a JobStateStore.
 * Auto-detects provider type and falls back to memory store.
 */
export function createJobStateStore(options?: JobStateStoreOptions, logger?: FrontMcpLogger): JobStateStoreResult {
  const keyPrefix = options?.keyPrefix ?? 'mcp:jobs:';
  const ttlSeconds = options?.ttlSeconds ?? 86400;

  if (options?.redis) {
    try {
      const { RedisJobStateStore } = require('./redis-job-state.store');
      const { url, host, port, password, db, tls } = options.redis;
      const client = createRedisClient({ url, host, port, password, db, tls, label: 'JobStateStore', logger });
      return {
        store: new RedisJobStateStore(client, logger, keyPrefix, ttlSeconds),
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
