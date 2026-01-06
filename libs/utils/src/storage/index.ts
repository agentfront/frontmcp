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
} from './errors';

// Adapters (for direct instantiation if needed)
export {
  BaseStorageAdapter,
  MemoryStorageAdapter,
  RedisStorageAdapter,
  VercelKvStorageAdapter,
  UpstashStorageAdapter,
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
