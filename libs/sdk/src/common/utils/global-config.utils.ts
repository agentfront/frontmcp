/**
 * Global Configuration Utilities
 *
 * Helper functions for plugins to access global configuration from @FrontMcp decorator.
 */

import type { FrontMcpConfigType } from '../metadata';
import type { RedisOptions } from '../types';
import { GlobalConfigNotFoundError } from '../../errors';

/**
 * Extract store configuration from global FrontMcp configuration.
 *
 * This helper is used by plugins that want to use the global redis/store
 * configuration instead of requiring explicit configuration.
 *
 * @param pluginName - Name of the plugin requesting the config (for error messages)
 * @param config - The FrontMcp configuration object
 * @returns The redis/store configuration
 * @throws GlobalConfigNotFoundError if redis is not configured
 *
 * @example
 * ```typescript
 * // In plugin dynamicProviders:
 * static dynamicProviders = (options: MyPluginOptions) => {
 *   if (options.type === 'global-store') {
 *     return [{
 *       provide: MyStoreToken,
 *       inject: () => [FrontMcpConfig],
 *       useFactory: (config: FrontMcpConfigType) => {
 *         const storeConfig = getGlobalStoreConfig('MyPlugin', config);
 *         return new MyStoreProvider(storeConfig);
 *       },
 *     }];
 *   }
 * };
 * ```
 */
export function getGlobalStoreConfig(pluginName: string, config: FrontMcpConfigType): RedisOptions {
  if (!config.redis) {
    throw new GlobalConfigNotFoundError(pluginName, 'redis');
  }
  return config.redis;
}
