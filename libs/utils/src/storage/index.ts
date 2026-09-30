/**
 * @frontmcp/utils - Storage Module
 *
 * Unified storage abstraction with pluggable backends.
 * Supports Memory (dev), Redis (prod), Vercel KV (edge), and Upstash (edge + pub/sub).
 */

// Core types
export type {
  StorageAdapter,
  NamespacedStorage,
  RootStorage,
  SetOptions,
  SetEntry,
  MessageHandler,
  Unsubscribe,
  MemoryAdapterOptions,
  RedisAdapterOptions,
  VercelKvAdapterOptions,
  UpstashAdapterOptions,
  StorageType,
  StorageConfig,
} from './types';

// Factory
export { createStorage, createMemoryStorage, getDetectedStorageType } from './factory';

// Redis client helpers
export { attachRedisErrorListener, DEFAULT_REDIS_ERROR_LOG_INTERVAL_MS } from './redis-error-listener';
export type { RedisErrorListenerOptions, ErrorEmitterClient } from './redis-error-listener';

// Namespace utilities
export {
  NamespacedStorageImpl,
  createRootStorage,
  createNamespacedStorage,
  buildPrefix,
  NAMESPACE_SEPARATOR,
} from './namespace';

// Error classes
export {
  StorageError,
  StorageConnectionError,
  StorageOperationError,
  StorageNotSupportedError,
  StorageConfigError,
  StorageTTLError,
  StoragePatternError,
  StorageNotConnectedError,
  EncryptedStorageError,
} from './errors';

// TypedStorage
export { TypedStorage } from './typed-storage';
export type { TypedStorageOptions, TypedSetOptions, TypedSetEntry } from './typed-storage.types';

// EncryptedTypedStorage
export { EncryptedTypedStorage } from './encrypted-typed-storage';
export type {
  EncryptedTypedStorageOptions,
  EncryptedSetOptions,
  EncryptedSetEntry,
  EncryptionKey,
  StoredEncryptedBlob,
  ClientKeyBinding,
} from './encrypted-typed-storage.types';

// Adapters (for direct instantiation if needed)
export {
  BaseStorageAdapter,
  MemoryStorageAdapter,
  RedisStorageAdapter,
  createRedisClient,
  VercelKvStorageAdapter,
  UpstashStorageAdapter,
  FileSystemStorageAdapter,
  LocalStorageAdapter,
  IndexedDBStorageAdapter,
} from './adapters';
export type {
  CreateRedisClientOptions,
  FileSystemAdapterOptions,
  LocalStorageAdapterOptions,
  IndexedDBAdapterOptions,
} from './adapters';

// Utilities (for advanced use)
export { globToRegex, matchesPattern, validatePattern, escapeGlob } from './utils/pattern';
export {
  MAX_TTL_SECONDS,
  validateTTL,
  validateOptionalTTL,
  ttlToExpiresAt,
  expiresAtToTTL,
  isExpired,
  normalizeTTL,
} from './utils/ttl';
