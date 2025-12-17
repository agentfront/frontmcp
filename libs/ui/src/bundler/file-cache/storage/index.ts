/**
 * Build Cache Storage
 *
 * Storage implementations for component build caching.
 *
 * @packageDocumentation
 */

// Interface
export {
  type BuildCacheStorage,
  type StorageOptions,
  type CacheEntry,
  type CacheEntryMetadata,
  DEFAULT_STORAGE_OPTIONS,
  calculateManifestSize,
} from './interface';

// Filesystem Storage
export { FilesystemStorage, createFilesystemStorage, type FilesystemStorageOptions } from './filesystem';

// Redis Storage
export { RedisStorage, createRedisStorage, type RedisStorageOptions, type RedisClient } from './redis';
