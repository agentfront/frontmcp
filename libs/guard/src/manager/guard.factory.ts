/**
 * Guard Factory
 *
 * SDK-agnostic factory for creating GuardManager instances.
 * Accepts a StorageConfig from @frontmcp/utils.
 */

import { createMemoryStorage, createStorage, type RootStorage } from '@frontmcp/utils';

import { GuardManager } from './guard.manager';
import type { CreateGuardManagerArgs } from './types';

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

  if (config.ipFilter?.trustProxy === true || (config.ipFilter?.trustedProxyDepth ?? 1) !== 1) {
    logger?.warn(
      'GuardManager: throttle.ipFilter.trustProxy and trustedProxyDepth are not read. The client IP is the socket ' +
        'peer; to use X-Forwarded-For behind a trusted proxy, set FRONTMCP_TRUST_PROXY=true and ' +
        'FRONTMCP_TRUSTED_PROXY_DEPTH=<hops> instead.',
    );
  }

  logger?.info('GuardManager initialized', {
    keyPrefix,
    hasGlobalRateLimit: !!config.global,
    hasGlobalConcurrency: !!config.globalConcurrency,
    hasDefaultRateLimit: !!config.defaultRateLimit,
    hasDefaultConcurrency: !!config.defaultConcurrency,
    hasDefaultTimeout: !!config.defaultTimeout,
    hasIpFilter: !!config.ipFilter,
  });

  return new GuardManager(namespacedStorage, config);
}
