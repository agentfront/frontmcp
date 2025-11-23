import type { DocumentEmbedding, DocumentMetadata } from '../interfaces';
import type { StorageAdapterConfig, StoredData, StorageMetadata, SerializedEmbedding } from './adapter.interface';
import * as SerializationUtils from './serialization.utils';

/**
 * Abstract base class for storage adapters
 * Provides common functionality and utilities to reduce code duplication
 */
export abstract class BaseStorageAdapter<T extends DocumentMetadata = DocumentMetadata> {
  protected config: Required<StorageAdapterConfig>;

  constructor(config: StorageAdapterConfig = {}) {
    this.config = {
      namespace: config.namespace ?? 'default',
      autoSave: config.autoSave ?? false,
      autoSaveInterval: config.autoSaveInterval ?? 60000,
    };
  }

  /**
   * Initialize the storage adapter
   */
  abstract initialize(): Promise<void>;

  /**
   * Load embeddings from storage
   */
  abstract load(): Promise<StoredData<T> | null>;

  /**
   * Save embeddings to storage
   */
  abstract save(data: StoredData<T>): Promise<void>;

  /**
   * Clear all stored data
   */
  abstract clear(): Promise<void>;

  /**
   * Close/cleanup the adapter
   */
  abstract close(): Promise<void>;

  /**
   * Check if cached data exists and is valid
   * Common implementation that works for most adapters
   */
  async hasValidCache(metadata: StorageMetadata): Promise<boolean> {
    try {
      const data = await this.load();
      if (!data) {
        return false;
      }

      return this.isMetadataValid(data.metadata, metadata);
    } catch {
      return false;
    }
  }

  /**
   * Validate if cached metadata matches current metadata
   * Checks version, toolsHash, and modelName
   */
  protected isMetadataValid(cachedMetadata: StorageMetadata, currentMetadata: StorageMetadata): boolean {
    // Check if version matches
    if (cachedMetadata.version !== currentMetadata.version) {
      return false;
    }

    // Check if tools hash matches (invalidate if tools changed)
    if (cachedMetadata.toolsHash !== currentMetadata.toolsHash) {
      return false;
    }

    // Check if model name matches
    if (cachedMetadata.modelName !== currentMetadata.modelName) {
      return false;
    }

    return true;
  }

  /**
   * Serialize a DocumentEmbedding to a SerializedEmbedding
   */
  protected serializeEmbedding(embedding: DocumentEmbedding<T>): SerializedEmbedding<T> {
    return SerializationUtils.serializeEmbedding(embedding);
  }

  /**
   * Deserialize a SerializedEmbedding to a DocumentEmbedding
   * Sanitizes metadata to prevent prototype pollution
   */
  protected deserializeEmbedding(serialized: SerializedEmbedding<T>): DocumentEmbedding<T> {
    return SerializationUtils.deserializeEmbedding(serialized);
  }

  /**
   * Create a cryptographic hash from a string using SHA-256
   * More secure than simple hash - prevents collision attacks
   */
  protected hash(input: string): string {
    return SerializationUtils.hash(input);
  }

  /**
   * Create a hash from document IDs and texts
   * Used to detect when tools/documents change
   */
  protected createToolsHash(documents: Array<{ id: string; text: string }>): string {
    return SerializationUtils.createToolsHash(documents);
  }

  /**
   * Safely parse JSON with error handling and prototype pollution protection
   */
  protected safeJsonParse<R>(content: string): R | null {
    try {
      const parsed = JSON.parse(content, (key, value) => {
        // Block prototype pollution
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
          return undefined;
        }
        return value;
      });

      // Additional sanitization for nested objects
      return SerializationUtils.sanitizeObject(parsed) as R;
    } catch {
      return null;
    }
  }

  /**
   * Safely stringify JSON with error handling
   */
  protected safeJsonStringify(data: unknown, pretty = false): string | null {
    try {
      return JSON.stringify(data, null, pretty ? 2 : undefined);
    } catch {
      return null;
    }
  }
}
