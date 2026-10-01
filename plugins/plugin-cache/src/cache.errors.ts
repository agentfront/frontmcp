/**
 * Error classes for the cache plugin.
 *
 * @module @frontmcp/plugin-cache
 */

/**
 * Raised when `CachePlugin` is configured with options it cannot honour, when the plugin is
 * created (`CachePlugin.init()`), so the server never starts with a setting that silently does nothing.
 */
export class CachePluginConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CachePluginConfigurationError';
  }
}
