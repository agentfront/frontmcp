/**
 * TaskStore factory — mirrors the elicitation-store factory pattern.
 *
 * Auto-detects the storage backend from config / env. Memory is the default
 * for single-node / development; Redis or Upstash is required for multi-node
 * deployments (both support pub/sub for cross-node terminal/cancel routing).
 *
 * Vercel KV is not supported (no pub/sub), matching the elicitation store.
 *
 * @module task/store/task-store.factory
 */

import { createMemoryStorage, createStorage, getEnv, type RootStorage, type StorageConfig } from '@frontmcp/utils';

import { type FrontMcpLogger, type RedisOptionsInput } from '../../common';
import { StorageTaskStore } from './storage-task.store';
import { type TaskStore } from './task.store';

export class TaskStoreNotSupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskStoreNotSupportedError';
  }
}

export interface TaskStoreOptions {
  /** Storage config (@frontmcp/utils shape). */
  storage?: StorageConfig;
  /** Convenience: legacy redis option, mapped into `storage` when `storage` is absent. */
  redis?: RedisOptionsInput;
  /** Key prefix for all task keys. Default `mcp:task:`. */
  keyPrefix?: string;
  /** Logger. */
  logger?: FrontMcpLogger;
  /** Edge runtime mode — requires distributed storage. */
  isEdgeRuntime?: boolean;
  /**
   * SQLite backend options. When provided, the factory returns a
   * `SqliteTaskStore` instead of the utils-backed implementation.
   * Required for cross-invocation persistence in CLI mode.
   */
  sqlite?: {
    path: string;
    encryption?: { secret: string };
    walMode?: boolean;
    ttlCleanupIntervalMs?: number;
  };
}

export interface TaskStoreResult {
  store: TaskStore;
  type: 'memory' | 'redis' | 'upstash' | 'sqlite' | 'auto';
  /**
   * Underlying storage instance (not populated for the SQLite backend, which
   * manages its own Database connection internally).
   */
  storage?: RootStorage;
}

/**
 * Report the actual backend of a resolved storage. The explicit config wins —
 * env-var probing is only a last-ditch guess when neither the config nor the
 * storage object carries a discriminator (e.g. an auto-detecting storage).
 */
function detectStorageType(
  storage: RootStorage,
  configuredType?: StorageConfig['type'],
): 'memory' | 'redis' | 'upstash' | 'auto' {
  if (configuredType === 'redis') return 'redis';
  if (configuredType === 'upstash') return 'upstash';
  if (configuredType === 'memory') return 'memory';
  const storageBackend =
    (storage as unknown as { type?: string; backendName?: string }).type ??
    (storage as unknown as { backendName?: string }).backendName;
  if (storageBackend === 'redis' || storageBackend === 'upstash' || storageBackend === 'memory') {
    return storageBackend;
  }
  if (getEnv('UPSTASH_REDIS_REST_URL')) return 'upstash';
  if (getEnv('REDIS_URL') || getEnv('REDIS_HOST')) return 'redis';
  return 'memory';
}

export async function createTaskStore(options: TaskStoreOptions = {}): Promise<TaskStoreResult> {
  const { storage: storageConfig, redis, keyPrefix = 'mcp:task:', logger, isEdgeRuntime = false, sqlite } = options;

  // Edge-runtime guard runs FIRST so SQLite (better-sqlite3 is a native module
  // and can't be loaded on Workers/Edge anyway) doesn't silently slip through.
  if (isEdgeRuntime && sqlite) {
    throw new TaskStoreNotSupportedError(
      'SQLite task store is not supported on Edge runtime (better-sqlite3 is a native module). Use Redis or Upstash.',
    );
  }

  // SQLite takes priority when configured — same pattern as the elicitation store.
  if (sqlite) {
    // Lazy-require so we don't bundle @frontmcp/storage-sqlite (and better-sqlite3)
    // for users that never enable the SQLite backend.
    const { SqliteTaskStore } = require('@frontmcp/storage-sqlite') as typeof import('@frontmcp/storage-sqlite');
    const store = new SqliteTaskStore({
      path: sqlite.path,
      encryption: sqlite.encryption,
      walMode: sqlite.walMode ?? true,
      ttlCleanupIntervalMs: sqlite.ttlCleanupIntervalMs ?? 60_000,
      logger: logger
        ? {
            debug: (m, meta) => logger.debug(m, meta),
            warn: (m, meta) => logger.warn(m, meta),
            error: (m, meta) => logger.error(m, meta),
          }
        : undefined,
    });
    logger?.info('[TaskStoreFactory] Created SQLite task store', { path: sqlite.path, keyPrefix });
    return { store: store as unknown as TaskStore, type: 'sqlite' };
  }

  let finalStorageConfig: StorageConfig | undefined = storageConfig;

  if (redis && !storageConfig) {
    if ('provider' in redis && redis.provider === 'vercel-kv') {
      throw new TaskStoreNotSupportedError(
        'Vercel KV is not supported for task stores. Task result blocking and cancel signalling require pub/sub. Use Redis or Upstash instead.',
      );
    }
    const isNewRedisFormat = 'provider' in redis && redis.provider === 'redis' && 'host' in redis;
    const isLegacyRedisFormat = !('provider' in redis) && 'host' in redis && typeof redis.host === 'string';
    if (isNewRedisFormat || isLegacyRedisFormat) {
      const cfg = redis as unknown as Record<string, unknown>;
      const host = typeof cfg['host'] === 'string' ? cfg['host'] : undefined;
      if (!host) {
        throw new TaskStoreNotSupportedError('Invalid Redis configuration: host is required.');
      }
      finalStorageConfig = {
        type: 'redis',
        redis: {
          config: {
            host,
            port: typeof cfg['port'] === 'number' ? cfg['port'] : 6379,
            password: typeof cfg['password'] === 'string' ? cfg['password'] : undefined,
            db: typeof cfg['db'] === 'number' ? cfg['db'] : 0,
            tls: typeof cfg['tls'] === 'boolean' ? cfg['tls'] : false,
          },
        },
      };
    }
  }

  if (finalStorageConfig?.type === 'vercel-kv' || getEnv('KV_REST_API_URL')) {
    throw new TaskStoreNotSupportedError(
      'Vercel KV is not supported for task stores (pub/sub required). Use Redis or Upstash.',
    );
  }

  if (isEdgeRuntime && (!finalStorageConfig || finalStorageConfig.type === 'memory')) {
    throw new TaskStoreNotSupportedError(
      'Tasks require distributed storage on Edge runtime. Configure Redis or Upstash.',
    );
  }

  const storage = await createStorage({
    ...finalStorageConfig,
    prefix: keyPrefix,
    fallback: isEdgeRuntime ? 'error' : 'memory',
  });

  const store: TaskStore = new StorageTaskStore(storage, logger);
  const type = detectStorageType(storage, finalStorageConfig?.type);

  logger?.info('[TaskStoreFactory] Created task store', {
    type,
    keyPrefix,
    supportsPubSub: storage.supportsPubSub(),
  });

  return { store, type, storage };
}

/** Synchronous memory-backed factory, primarily for tests. */
export function createMemoryTaskStore(options: { keyPrefix?: string; logger?: FrontMcpLogger } = {}): TaskStoreResult {
  const { keyPrefix = 'mcp:task:', logger } = options;
  const storage = createMemoryStorage({ prefix: keyPrefix });
  return { store: new StorageTaskStore(storage, logger), type: 'memory', storage };
}
