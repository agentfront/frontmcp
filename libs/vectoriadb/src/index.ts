/**
 * VectoriaDB - A lightweight, production-ready in-memory vector database
 *
 * @packageDocumentation
 */

export { VectoriaDB } from './vectoria';
export { EmbeddingService } from './embedding.service';
export { HNSWIndex } from './hnsw.index';
export type { HNSWConfig } from './hnsw.index';
export * from './similarity.utils';
export * from './interfaces';

// Storage adapters
export { MemoryStorageAdapter } from './storage/memory.adapter';
export { FileStorageAdapter } from './storage/file.adapter';
export type { FileStorageConfig } from './storage/file.adapter';
export { RedisStorageAdapter } from './storage/redis.adapter';
export type { RedisStorageConfig, RedisClient } from './storage/redis.adapter';
export { SerializationUtils } from './storage/adapter.interface';
export type {
  StorageAdapter,
  StorageAdapterConfig,
  StorageMetadata,
  StoredData,
  SerializedEmbedding,
} from './storage/adapter.interface';

// Error classes
export {
  VectoriaError,
  VectoriaNotInitializedError,
  DocumentValidationError,
  DocumentNotFoundError,
  DocumentExistsError,
  DuplicateDocumentError,
  QueryValidationError,
  EmbeddingError,
  StorageError,
  ConfigurationError,
} from './errors';
