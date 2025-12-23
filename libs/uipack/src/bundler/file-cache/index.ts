/**
 * File-Based Component Caching
 *
 * SHA-based caching system for file-based UI component builds.
 * Supports filesystem (development) and Redis (production) storage.
 *
 * @packageDocumentation
 */

// Storage
export {
  // Interface
  type BuildCacheStorage,
  type StorageOptions,
  type CacheEntry,
  type CacheEntryMetadata,
  DEFAULT_STORAGE_OPTIONS,
  calculateManifestSize,
  // Filesystem
  FilesystemStorage,
  createFilesystemStorage,
  type FilesystemStorageOptions,
  // Redis
  RedisStorage,
  createRedisStorage,
  type RedisStorageOptions,
  type RedisClient,
} from './storage';

// Hash Calculator
export {
  sha256,
  sha256Buffer,
  hashFile,
  hashFiles,
  calculateComponentHash,
  calculateQuickHash,
  generateBuildId,
  buildIdFromHash,
  type ComponentHashOptions,
  type ComponentHashResult,
} from './hash-calculator';

// Component Builder
export {
  ComponentBuilder,
  createFilesystemBuilder,
  createRedisBuilder,
  type ComponentBuildOptions,
  type ComponentBuildResult,
} from './component-builder';
