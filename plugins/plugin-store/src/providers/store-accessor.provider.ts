import type { StoreAdapter } from '../store.types';
import type { StoreRegistry } from './store-registry.provider';

/**
 * StoreAccessor provides a convenient API for tools to access stores.
 * Available as `this.store` in tools when StorePlugin is installed.
 */
export class StoreAccessor {
  constructor(private registry: StoreRegistry) {}

  /**
   * Get a value from a named store at an optional path.
   */
  get(storeName: string, path?: string[]): unknown {
    return this.registry.getState(storeName, path);
  }

  /**
   * Set a value in a named store at a path.
   */
  set(storeName: string, path: string[], value: unknown): void {
    this.registry.setState(storeName, path, value);
  }

  /**
   * Get the raw store adapter for advanced operations.
   */
  getStore(storeName: string): StoreAdapter | undefined {
    return this.registry.get(storeName);
  }

  /**
   * List all registered store names.
   */
  list(): string[] {
    return this.registry.list();
  }
}
