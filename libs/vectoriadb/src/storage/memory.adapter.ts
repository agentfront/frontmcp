import type { DocumentMetadata } from '../interfaces';
import type { StorageAdapterConfig, StoredData, StorageMetadata } from './adapter.interface';
import { BaseStorageAdapter } from './base.adapter';

/**
 * In-memory storage adapter (no persistence)
 * This is the default adapter - data is lost on restart
 */
export class MemoryStorageAdapter<T extends DocumentMetadata = DocumentMetadata> extends BaseStorageAdapter<T> {
  private data: StoredData<T> | null = null;

  constructor(config: StorageAdapterConfig = {}) {
    super(config);
  }

  override async initialize(): Promise<void> {
    // No initialization needed for memory adapter
  }

  override async hasValidCache(_metadata: StorageMetadata): Promise<boolean> {
    // Memory adapter never has cached data on startup
    return false;
  }

  override async load(): Promise<StoredData<T> | null> {
    return this.data;
  }

  override async save(data: StoredData<T>): Promise<void> {
    this.data = data;
  }

  override async clear(): Promise<void> {
    this.data = null;
  }

  override async close(): Promise<void> {
    this.data = null;
  }
}
