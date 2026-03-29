import { Provider, ProviderScope } from '@frontmcp/sdk';
import type { Token } from '@frontmcp/di';

export const DATA_STORE_TOKEN: Token<DataStoreService> = Symbol('DataStore');

export interface DataStoreEntry {
  key: string;
  value: string;
  createdAt: number;
}

@Provider({
  name: 'DataStoreService',
  scope: ProviderScope.GLOBAL,
})
export class DataStoreService {
  private readonly store = new Map<string, DataStoreEntry>();
  readonly instanceId = `store-${Math.random().toString(36).substring(2, 10)}`;

  set(key: string, value: string): void {
    this.store.set(key, { key, value, createdAt: Date.now() });
  }

  get(key: string): DataStoreEntry | undefined {
    return this.store.get(key);
  }

  getAll(): DataStoreEntry[] {
    return Array.from(this.store.values());
  }

  getInstanceId(): string {
    return this.instanceId;
  }
}
