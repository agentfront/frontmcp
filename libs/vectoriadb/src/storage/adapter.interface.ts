import type { DocumentEmbedding, DocumentMetadata } from '../interfaces';

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
 */
export class SerializationUtils {
  /**
   * Serialize a DocumentEmbedding to a SerializedEmbedding
   */
  static serializeEmbedding<T extends DocumentMetadata>(embedding: DocumentEmbedding<T>): SerializedEmbedding<T> {
    return {
      id: embedding.id,
      vector: Array.from(embedding.vector),
      metadata: embedding.metadata,
      text: embedding.text,
      createdAt: embedding.createdAt.toISOString(),
    };
  }

  /**
   * Deserialize a SerializedEmbedding to a DocumentEmbedding
   */
  static deserializeEmbedding<T extends DocumentMetadata>(serialized: SerializedEmbedding<T>): DocumentEmbedding<T> {
    return {
      id: serialized.id,
      vector: new Float32Array(serialized.vector),
      metadata: serialized.metadata,
      text: serialized.text,
      createdAt: new Date(serialized.createdAt),
    };
  }

  /**
   * Create a hash from a string (simple implementation)
   */
  static hash(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Create a hash from document IDs and texts
   * Used to detect when tools/documents change
   */
  static createToolsHash(documents: Array<{ id: string; text: string }>): string {
    const content = documents
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((d) => `${d.id}:${d.text}`)
      .join('|');
    return this.hash(content);
  }
}
