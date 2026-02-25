import { JobStateStore } from './job-state.interface';
import { MemoryJobStateStore } from './memory-job-state.store';
import { FrontMcpLogger } from '../../common/interfaces/logger.interface';

export interface JobStateStoreOptions {
  redis?: {
    provider: string;
    host?: string;
    port?: number;
    url?: string;
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
      const Redis = require('ioredis');
      const client = options.redis.url
        ? new Redis(options.redis.url)
        : new Redis({
            host: options.redis.host ?? 'localhost',
            port: options.redis.port ?? 6379,
          });
      return {
        store: new RedisJobStateStore(client, logger, keyPrefix, ttlSeconds),
        type: 'redis',
      };
    } catch (err) {
      logger?.warn?.(`Failed to create Redis job state store, falling back to memory: ${err}`);
    }
  }

  return {
    store: new MemoryJobStateStore(),
    type: 'memory',
  };
}
