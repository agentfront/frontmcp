import type { DocumentMetadata } from '../interfaces';
import type { StorageAdapter, StorageAdapterConfig, StoredData, StorageMetadata } from './adapter.interface';

/**
 * In-memory storage adapter (no persistence)
 * This is the default adapter - data is lost on restart
 */
export class MemoryStorageAdapter<T extends DocumentMetadata = DocumentMetadata> implements StorageAdapter<T> {
  private data: StoredData<T> | null = null;

  constructor(private config: StorageAdapterConfig = {}) {}

  async initialize(): Promise<void> {
    // No initialization needed for memory adapter
  }

  async hasValidCache(_metadata: StorageMetadata): Promise<boolean> {
    // Memory adapter never has cached data on startup
    return false;
  }

  async load(): Promise<StoredData<T> | null> {
    return this.data;
  }

  async save(data: StoredData<T>): Promise<void> {
    this.data = data;
  }

  async clear(): Promise<void> {
    this.data = null;
  }

  async close(): Promise<void> {
    this.data = null;
  }
}
