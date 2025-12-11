/**
 * Adapter Registry
 *
 * Manages platform adapter registration and auto-detection.
 * Adapters are registered with priorities and selected based on
 * environment detection during initialization.
 *
 * @packageDocumentation
 */

import type { PlatformAdapter, AdapterFactory, AdapterRegistration, AdapterConfig } from '../types';

/**
 * Registry for managing platform adapters.
 * Handles registration, retrieval, and auto-detection of adapters.
 */
export class AdapterRegistry {
  private _adapters: Map<string, AdapterRegistration> = new Map();
  private _disabledAdapters: Set<string> = new Set();
  private _adapterConfigs: Map<string, AdapterConfig> = new Map();
  private _debug = false;

  /**
   * Enable or disable debug logging.
   */
  setDebug(enabled: boolean): void {
    this._debug = enabled;
  }

  /**
   * Register an adapter factory with the registry.
   * @param id - Unique adapter identifier
   * @param factory - Factory function that creates the adapter
   * @param defaultConfig - Optional default configuration
   */
  register(id: string, factory: AdapterFactory, defaultConfig?: AdapterConfig): void {
    if (this._adapters.has(id)) {
      this._log(`Overwriting existing adapter: ${id}`);
    }

    this._adapters.set(id, {
      id,
      factory,
      defaultConfig,
    });

    this._log(`Registered adapter: ${id}`);
  }

  /**
   * Unregister an adapter from the registry.
   * @param id - Adapter identifier to remove
   */
  unregister(id: string): boolean {
    const removed = this._adapters.delete(id);
    if (removed) {
      this._log(`Unregistered adapter: ${id}`);
    }
    return removed;
  }

  /**
   * Check if an adapter is registered.
   * @param id - Adapter identifier
   */
  has(id: string): boolean {
    return this._adapters.has(id);
  }

  /**
   * Get all registered adapter IDs.
   */
  getRegisteredIds(): string[] {
    return Array.from(this._adapters.keys());
  }

  /**
   * Disable specific adapters (they won't be selected during auto-detection).
   * @param ids - Adapter IDs to disable
   */
  disable(...ids: string[]): void {
    for (const id of ids) {
      this._disabledAdapters.add(id);
      this._log(`Disabled adapter: ${id}`);
    }
  }

  /**
   * Enable previously disabled adapters.
   * @param ids - Adapter IDs to enable
   */
  enable(...ids: string[]): void {
    for (const id of ids) {
      this._disabledAdapters.delete(id);
      this._log(`Enabled adapter: ${id}`);
    }
  }

  /**
   * Check if an adapter is disabled.
   * @param id - Adapter identifier
   */
  isDisabled(id: string): boolean {
    return this._disabledAdapters.has(id);
  }

  /**
   * Set adapter-specific configuration.
   * @param id - Adapter identifier
   * @param config - Configuration to apply
   */
  configure(id: string, config: AdapterConfig): void {
    this._adapterConfigs.set(id, config);
    this._log(`Configured adapter: ${id}`);
  }

  /**
   * Get an adapter instance by ID.
   * @param id - Adapter identifier
   * @returns Adapter instance or undefined if not found/disabled
   */
  get(id: string): PlatformAdapter | undefined {
    if (this._disabledAdapters.has(id)) {
      this._log(`Adapter ${id} is disabled`);
      return undefined;
    }

    const registration = this._adapters.get(id);
    if (!registration) {
      this._log(`Adapter ${id} not found`);
      return undefined;
    }

    const config = this._mergeConfig(registration.defaultConfig, this._adapterConfigs.get(id));

    if (config?.enabled === false) {
      this._log(`Adapter ${id} is disabled via config`);
      return undefined;
    }

    return registration.factory(config);
  }

  /**
   * Auto-detect and return the best adapter for the current environment.
   * Adapters are checked in priority order (highest first).
   * @returns The first adapter that can handle the current environment, or undefined
   */
  detect(): PlatformAdapter | undefined {
    const candidates = this._getSortedCandidates();

    for (const registration of candidates) {
      if (this._disabledAdapters.has(registration.id)) {
        this._log(`Skipping disabled adapter: ${registration.id}`);
        continue;
      }

      const config = this._mergeConfig(registration.defaultConfig, this._adapterConfigs.get(registration.id));

      if (config?.enabled === false) {
        this._log(`Skipping adapter disabled via config: ${registration.id}`);
        continue;
      }

      try {
        const adapter = registration.factory(config);

        if (adapter.canHandle()) {
          this._log(`Detected adapter: ${registration.id} (priority: ${adapter.priority})`);
          return adapter;
        }

        this._log(`Adapter ${registration.id} cannot handle current environment`);
      } catch (error) {
        this._log(`Error creating adapter ${registration.id}: ${error}`);
      }
    }

    this._log('No suitable adapter detected');
    return undefined;
  }

  /**
   * Get all adapters that can handle the current environment.
   * Useful for debugging or showing available options.
   * @returns Array of compatible adapters sorted by priority (highest first)
   */
  detectAll(): PlatformAdapter[] {
    const candidates = this._getSortedCandidates();
    const compatible: PlatformAdapter[] = [];

    for (const registration of candidates) {
      if (this._disabledAdapters.has(registration.id)) {
        continue;
      }

      const config = this._mergeConfig(registration.defaultConfig, this._adapterConfigs.get(registration.id));

      if (config?.enabled === false) {
        continue;
      }

      try {
        const adapter = registration.factory(config);

        if (adapter.canHandle()) {
          compatible.push(adapter);
        }
      } catch {
        // Skip adapters that fail to instantiate
      }
    }

    return compatible;
  }

  /**
   * Clear all registered adapters.
   */
  clear(): void {
    this._adapters.clear();
    this._disabledAdapters.clear();
    this._adapterConfigs.clear();
    this._log('Cleared all adapters');
  }

  /**
   * Get sorted candidate adapters by priority (highest first).
   */
  private _getSortedCandidates(): AdapterRegistration[] {
    const registrations = Array.from(this._adapters.values());

    // Create temporary adapters to get their priorities
    const withPriority = registrations.map((reg) => {
      try {
        const adapter = reg.factory(reg.defaultConfig);
        return { registration: reg, priority: adapter.priority };
      } catch {
        return { registration: reg, priority: -1 };
      }
    });

    // Sort by priority descending
    withPriority.sort((a, b) => b.priority - a.priority);

    return withPriority.map((item) => item.registration);
  }

  /**
   * Merge default config with user config.
   */
  private _mergeConfig(defaultConfig?: AdapterConfig, userConfig?: AdapterConfig): AdapterConfig | undefined {
    if (!defaultConfig && !userConfig) {
      return undefined;
    }

    return {
      ...defaultConfig,
      ...userConfig,
      options: {
        ...defaultConfig?.options,
        ...userConfig?.options,
      },
    };
  }

  /**
   * Log debug message if debugging is enabled.
   */
  private _log(message: string): void {
    if (this._debug) {
      console.log(`[AdapterRegistry] ${message}`);
    }
  }
}

/**
 * Default global adapter registry instance.
 * Use this for the standard registration pattern.
 */
export const defaultRegistry = new AdapterRegistry();

/**
 * Helper function to register an adapter with the default registry.
 * @param id - Unique adapter identifier
 * @param factory - Factory function that creates the adapter
 * @param defaultConfig - Optional default configuration
 */
export function registerAdapter(id: string, factory: AdapterFactory, defaultConfig?: AdapterConfig): void {
  defaultRegistry.register(id, factory, defaultConfig);
}

/**
 * Helper function to get an adapter from the default registry.
 * @param id - Adapter identifier
 */
export function getAdapter(id: string): PlatformAdapter | undefined {
  return defaultRegistry.get(id);
}

/**
 * Helper function to auto-detect the best adapter from the default registry.
 */
export function detectAdapter(): PlatformAdapter | undefined {
  return defaultRegistry.detect();
}
