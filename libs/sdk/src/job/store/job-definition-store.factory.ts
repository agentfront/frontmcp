import { JobDefinitionStore } from './job-definition.interface';
import { MemoryJobDefinitionStore } from './memory-job-definition.store';
import { FrontMcpLogger } from '../../common/interfaces/logger.interface';

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
    host?: string;
    port?: number;
    url?: string;
    [key: string]: unknown;
  };
  keyPrefix?: string;
}

export interface JobDefinitionStoreResult {
  store: JobDefinitionStore;
  type: 'redis' | 'memory';
}

/**
 * Factory function to create a JobDefinitionStore.
 * Auto-detects provider type and falls back to memory store.
 */
export function createJobDefinitionStore(
  options?: JobDefinitionStoreOptions,
  logger?: FrontMcpLogger,
): JobDefinitionStoreResult {
  const keyPrefix = options?.keyPrefix ?? 'mcp:jobs:def:';
  const effectiveLogger = logger ?? noopLogger;

  if (options?.redis) {
    try {
      const { RedisJobDefinitionStore } = require('./redis-job-definition.store');
      const Redis = require('ioredis');
      const client = options.redis.url
        ? new Redis(options.redis.url)
        : new Redis({
            host: options.redis.host ?? 'localhost',
            port: options.redis.port ?? 6379,
          });
      return {
        store: new RedisJobDefinitionStore(client, effectiveLogger, keyPrefix),
        type: 'redis',
      };
    } catch (err) {
      effectiveLogger.warn(`Failed to create Redis job definition store, falling back to memory: ${err}`);
    }
  }

  return {
    store: new MemoryJobDefinitionStore(),
    type: 'memory',
  };
}
