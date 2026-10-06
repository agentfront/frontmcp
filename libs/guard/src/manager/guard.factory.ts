/**
 * Guard Factory
 *
 * SDK-agnostic factory for creating GuardManager instances.
 * Accepts a StorageConfig from @frontmcp/utils.
 */

import { createMemoryStorage, createStorage, isProduction, type RootStorage } from '@frontmcp/utils';

import { GuardStorageUnavailableError } from '../errors';
import { GuardManager } from './guard.manager';
import type { CreateGuardManagerArgs } from './types';

/**
 * Create and initialize a GuardManager with the appropriate storage backend.
 *
 * If config.storage is set, uses that directly.
 * Otherwise falls back to in-memory storage.
 *
 * A configured backend that cannot be reached rejects with
 * {@link GuardStorageUnavailableError}: rate limits fail closed unless
 * `storage.fallback: 'memory'` allows per-instance counters. The same policy
 * applies if the backend stops answering later, while the server runs.
 */
/**
 * `prefix` without its trailing colons. A scan, not `/:+$/`, which backtracks
 * quadratically on a long run of colons that doesn't end the string.
 */
function withoutTrailingColons(prefix: string): string {
  let end = prefix.length;
  while (end > 0 && prefix.charCodeAt(end - 1) === 58 /* ':' */) end--;
  return prefix.slice(0, end);
}

export async function createGuardManager(args: CreateGuardManagerArgs): Promise<GuardManager> {
  const { config, logger } = args;
  const keyPrefix = config.keyPrefix ?? 'mcp:guard:';

  let storage: RootStorage;

  if (config.storage) {
    try {
      storage = await createStorage(config.storage);
      await storage.connect();
    } catch (error) {
      throw new GuardStorageUnavailableError(config.storage.type ?? 'auto', error);
    }
  } else {
    logger?.warn(
      'GuardManager: No storage config provided, using in-memory storage (not suitable for distributed deployments)',
    );
    storage = createMemoryStorage();
    await storage.connect();
  }

  // `namespace()` appends its own separator, so a trailing one here would write
  // `mcp:guard::<entity>:…`.
  const namespacedStorage = storage.namespace(withoutTrailingColons(keyPrefix));

  logger?.info('GuardManager initialized', {
    keyPrefix,
    hasGlobalRateLimit: !!config.global,
    hasGlobalConcurrency: !!config.globalConcurrency,
    hasDefaultRateLimit: !!config.defaultRateLimit,
    hasDefaultConcurrency: !!config.defaultConcurrency,
    hasDefaultTimeout: !!config.defaultTimeout,
    hasIpFilter: !!config.ipFilter,
  });

  return new GuardManager(namespacedStorage, config, {
    storageType: config.storage?.type ?? (config.storage ? 'auto' : 'memory'),
    // Same default as `createStorage`: fail closed in production, per-instance counters otherwise.
    fallback: config.storage?.fallback ?? (isProduction() ? 'error' : 'memory'),
    logger,
  });
}
