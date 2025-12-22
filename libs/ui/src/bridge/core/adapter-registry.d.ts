/**
 * Adapter Registry
 *
 * Manages platform adapter registration and auto-detection.
 * Adapters are registered with priorities and selected based on
 * environment detection during initialization.
 *
 * @packageDocumentation
 */
import type { PlatformAdapter, AdapterFactory, AdapterConfig } from '../types';
/**
 * Registry for managing platform adapters.
 * Handles registration, retrieval, and auto-detection of adapters.
 */
export declare class AdapterRegistry {
  private _adapters;
  private _disabledAdapters;
  private _adapterConfigs;
  private _debug;
  /**
   * Enable or disable debug logging.
   */
  setDebug(enabled: boolean): void;
  /**
   * Register an adapter factory with the registry.
   * @param id - Unique adapter identifier
   * @param factory - Factory function that creates the adapter
   * @param defaultConfig - Optional default configuration
   */
  register(id: string, factory: AdapterFactory, defaultConfig?: AdapterConfig): void;
  /**
   * Unregister an adapter from the registry.
   * @param id - Adapter identifier to remove
   */
  unregister(id: string): boolean;
  /**
   * Check if an adapter is registered.
   * @param id - Adapter identifier
   */
  has(id: string): boolean;
  /**
   * Get all registered adapter IDs.
   */
  getRegisteredIds(): string[];
  /**
   * Disable specific adapters (they won't be selected during auto-detection).
   * @param ids - Adapter IDs to disable
   */
  disable(...ids: string[]): void;
  /**
   * Enable previously disabled adapters.
   * @param ids - Adapter IDs to enable
   */
  enable(...ids: string[]): void;
  /**
   * Check if an adapter is disabled.
   * @param id - Adapter identifier
   */
  isDisabled(id: string): boolean;
  /**
   * Set adapter-specific configuration.
   * @param id - Adapter identifier
   * @param config - Configuration to apply
   */
  configure(id: string, config: AdapterConfig): void;
  /**
   * Get an adapter instance by ID.
   * @param id - Adapter identifier
   * @returns Adapter instance or undefined if not found/disabled
   */
  get(id: string): PlatformAdapter | undefined;
  /**
   * Auto-detect and return the best adapter for the current environment.
   * Adapters are checked in priority order (highest first).
   * @returns The first adapter that can handle the current environment, or undefined
   */
  detect(): PlatformAdapter | undefined;
  /**
   * Get all adapters that can handle the current environment.
   * Useful for debugging or showing available options.
   * @returns Array of compatible adapters sorted by priority (highest first)
   */
  detectAll(): PlatformAdapter[];
  /**
   * Clear all registered adapters.
   */
  clear(): void;
  /**
   * Get sorted candidate adapters by priority (highest first).
   */
  private _getSortedCandidates;
  /**
   * Merge default config with user config.
   */
  private _mergeConfig;
  /**
   * Log debug message if debugging is enabled.
   */
  private _log;
}
/**
 * Default global adapter registry instance.
 * Use this for the standard registration pattern.
 */
export declare const defaultRegistry: AdapterRegistry;
/**
 * Helper function to register an adapter with the default registry.
 * @param id - Unique adapter identifier
 * @param factory - Factory function that creates the adapter
 * @param defaultConfig - Optional default configuration
 */
export declare function registerAdapter(id: string, factory: AdapterFactory, defaultConfig?: AdapterConfig): void;
/**
 * Helper function to get an adapter from the default registry.
 * @param id - Adapter identifier
 */
export declare function getAdapter(id: string): PlatformAdapter | undefined;
/**
 * Helper function to auto-detect the best adapter from the default registry.
 */
export declare function detectAdapter(): PlatformAdapter | undefined;
//# sourceMappingURL=adapter-registry.d.ts.map
