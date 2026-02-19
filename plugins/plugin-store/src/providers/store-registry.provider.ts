import type { StoreAdapter } from '../store.types';

/**
 * StoreRegistry manages named store adapters.
 * Singleton per server instance.
 */
export class StoreRegistry {
  private stores = new Map<string, StoreAdapter>();

  constructor(stores: Record<string, StoreAdapter> = {}) {
    for (const [name, adapter] of Object.entries(stores)) {
      this.stores.set(name, adapter);
    }
  }

  get(name: string): StoreAdapter | undefined {
    return this.stores.get(name);
  }

  set(name: string, adapter: StoreAdapter): void {
    this.stores.set(name, adapter);
  }

  has(name: string): boolean {
    return this.stores.has(name);
  }

  list(): string[] {
    return Array.from(this.stores.keys());
  }

  getState(storeName: string, path?: string[]): unknown {
    const store = this.stores.get(storeName);
    if (!store) throw new Error(`Store '${storeName}' not found`);
    return path ? store.getState(path) : store.getState();
  }

  setState(storeName: string, path: string[], value: unknown): void {
    const store = this.stores.get(storeName);
    if (!store) throw new Error(`Store '${storeName}' not found`);
    store.setState(path, value);
  }

  subscribe(storeName: string, listener: () => void): () => void {
    const store = this.stores.get(storeName);
    if (!store) throw new Error(`Store '${storeName}' not found`);
    return store.subscribe(listener);
  }

  dispose(): void {
    for (const store of this.stores.values()) {
      store.dispose?.();
    }
    this.stores.clear();
  }
}
