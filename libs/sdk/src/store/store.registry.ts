import type { StoreDriver, StoreRegistryInterface } from './store.types';
import { Scope } from '../scope';

export class StoreRegistry implements StoreRegistryInterface {
  private readonly map = new Map<string, StoreDriver>();
  register(name: string, driver: StoreDriver): void {
    this.map.set(name, driver);
  }
  get(name: string): StoreDriver | undefined {
    return this.map.get(name);
  }
  ensure(name: string): StoreDriver {
    const d = this.map.get(name);
    if (!d) throw new Error(`No store driver named "${name}"`);
    return d;
  }
  has(name: string): boolean {
    return this.map.has(name);
  }
  list(): string[] {
    return Array.from(this.map.keys());
  }
}

export type StoreRegistryLocator = (scopeId: Scope['id']) => StoreRegistryInterface;
let locator: StoreRegistryLocator | null = null;

export function configureStoreRegistryLocator(l: StoreRegistryLocator) {
  locator = l;
}
export function getRegistryForScope(scopeId: Scope['id']): StoreRegistryInterface {
  if (!locator) throw new Error('StoreRegistry locator not configured');
  return locator(scopeId);
}
