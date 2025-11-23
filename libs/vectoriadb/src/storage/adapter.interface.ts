import type { DocumentEmbedding, DocumentMetadata } from '../interfaces';
import { BaseStorageAdapter } from './base.adapter';

/**
 * Metadata for the stored embeddings
 * Used for versioning and invalidation
 */
export interface StorageMetadata {
  /**
   * Version of VectoriaDB (for compatibility)
   */
  version: string;

  /**
   * Hash of the tools/documents schema
   * Used to invalidate cache when tools change
   */
  toolsHash: string;

  /**
   * Timestamp when the data was stored
   */
  timestamp: number;

  /**
   * Model name used for embeddings
   */
  modelName: string;

  /**
   * Vector dimensions
   */
  dimensions: number;

  /**
   * Number of documents stored
   */
  documentCount: number;
}

/**
 * Stored data with metadata and embeddings
 */
export interface StoredData<T extends DocumentMetadata = DocumentMetadata> {
  metadata: StorageMetadata;
  embeddings: SerializedEmbedding<T>[];
}

/**
 * Serialized embedding (Float32Array cannot be directly JSON serialized)
 */
export interface SerializedEmbedding<T extends DocumentMetadata = DocumentMetadata> {
  id: string;
  vector: number[]; // Float32Array serialized as number[]
  metadata: T;
  text: string;
  createdAt: string; // Date serialized as ISO string
}

/**
 * Configuration for storage adapters
 */
export interface StorageAdapterConfig {
  /**
   * Namespace/prefix for storage keys
   * Useful for multi-tenant scenarios
   */
  namespace?: string;

  /**
   * Whether to automatically save on changes
   * @default false
   */
  autoSave?: boolean;

  /**
   * Interval for auto-save in milliseconds
   * Only used if autoSave is true
   * @default 60000 (1 minute)
   */
  autoSaveInterval?: number;
}

/**
 * Storage adapter interface for persisting embeddings
 */
export interface StorageAdapter<T extends DocumentMetadata = DocumentMetadata> {
  /**
   * Initialize the storage adapter
   */
  initialize(): Promise<void>;

  /**
   * Check if cached data exists and is valid
   */
  hasValidCache(metadata: StorageMetadata): Promise<boolean>;

  /**
   * Load embeddings from storage
   */
  load(): Promise<StoredData<T> | null>;

  /**
   * Save embeddings to storage
   */
  save(data: StoredData<T>): Promise<void>;

  /**
   * Clear all stored data
   */
  clear(): Promise<void>;

  /**
   * Close/cleanup the adapter
   */
  close(): Promise<void>;
}

/**
 * Utility functions for serialization
 * Delegates to BaseStorageAdapter for implementation
 * @deprecated Use BaseStorageAdapter methods directly in adapters
 */
export class SerializationUtils extends BaseStorageAdapter {
  private static instance = new SerializationUtils();

  private constructor() {
    super({});
  }

  /**
   * Serialize a DocumentEmbedding to a SerializedEmbedding
   */
  static serializeEmbedding<T extends DocumentMetadata>(embedding: DocumentEmbedding<T>): SerializedEmbedding<T> {
    return this.instance.serializeEmbedding(embedding) as SerializedEmbedding<T>;
  }

  /**
   * Deserialize a SerializedEmbedding to a DocumentEmbedding
   */
  static deserializeEmbedding<T extends DocumentMetadata>(serialized: SerializedEmbedding<T>): DocumentEmbedding<T> {
    return this.instance.deserializeEmbedding(serialized) as DocumentEmbedding<T>;
  }

  /**
   * Create a hash from a string (simple implementation)
   */
  static hash(input: string): string {
    return this.instance.hash(input);
  }

  /**
   * Create a hash from document IDs and texts
   * Used to detect when tools/documents change
   */
  static createToolsHash(documents: Array<{ id: string; text: string }>): string {
    return this.instance.createToolsHash(documents);
  }

  // Required abstract methods (not used in singleton pattern)
  async initialize(): Promise<void> {}
  async load(): Promise<StoredData | null> {
    return null;
  }
  async save(_data: StoredData): Promise<void> {}
  async clear(): Promise<void> {}
  async close(): Promise<void> {}
}

// Export base class for adapters to extend
export { BaseStorageAdapter };
