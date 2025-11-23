import type { DocumentMetadata } from '../interfaces';
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

// Export base class for adapters to extend
export { BaseStorageAdapter };
