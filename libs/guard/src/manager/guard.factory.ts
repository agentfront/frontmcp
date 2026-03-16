/**
 * Guard Factory
 *
 * SDK-agnostic factory for creating GuardManager instances.
 * Accepts a StorageConfig from @frontmcp/utils.
 */

import type { RootStorage, StorageConfig } from '@frontmcp/utils';
import { createStorage, createMemoryStorage } from '@frontmcp/utils';
import type { GuardConfig, GuardLogger, CreateGuardManagerArgs } from './types';
import { GuardManager } from './guard.manager';

/**
 * Create and initialize a GuardManager with the appropriate storage backend.
 *
 * If config.storage is set, uses that directly.
 * Otherwise falls back to in-memory storage.
 */
export async function createGuardManager(args: CreateGuardManagerArgs): Promise<GuardManager> {
  const { config, logger } = args;
  const keyPrefix = config.keyPrefix ?? 'mcp:guard:';

  let storage: RootStorage;

  if (config.storage) {
    storage = await createStorage(config.storage);
  } else {
    logger?.warn(
      'GuardManager: No storage config provided, using in-memory storage (not suitable for distributed deployments)',
    );
    storage = createMemoryStorage();
  }

  await storage.connect();

  const namespacedStorage = storage.namespace(keyPrefix);

  logger?.info('GuardManager initialized', {
    keyPrefix,
    hasGlobalRateLimit: !!config.global,
    hasGlobalConcurrency: !!config.globalConcurrency,
    hasDefaultRateLimit: !!config.defaultRateLimit,
    hasDefaultConcurrency: !!config.defaultConcurrency,
    hasDefaultTimeout: !!config.defaultTimeout,
    hasIpFilter: !!config.ipFilter,
  } as unknown as string);

  return new GuardManager(namespacedStorage, config);
}
