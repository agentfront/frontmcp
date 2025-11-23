import type { DocumentEmbedding, DocumentMetadata } from '../interfaces';
import type { StorageAdapterConfig, StoredData, StorageMetadata, SerializedEmbedding } from './adapter.interface';

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
  protected deserializeEmbedding(serialized: SerializedEmbedding<T>): DocumentEmbedding<T> {
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
  protected hash(input: string): string {
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
  protected createToolsHash(documents: Array<{ id: string; text: string }>): string {
    const content = documents
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((d) => `${d.id}:${d.text}`)
      .join('|');
    return this.hash(content);
  }

  /**
   * Safely parse JSON with error handling
   */
  protected safeJsonParse<R>(content: string): R | null {
    try {
      return JSON.parse(content) as R;
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
