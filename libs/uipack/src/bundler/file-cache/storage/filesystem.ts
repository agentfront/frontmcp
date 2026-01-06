/**
 * Filesystem Build Cache Storage
 *
 * File-based cache storage for development environments.
 * Uses LRU eviction and stores manifests as JSON files.
 *
 * @packageDocumentation
 */

import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { createHash } from 'crypto';
import { mkdir, readFile, writeFile, readdir, unlink, rm } from '@frontmcp/utils';

import type { ComponentBuildManifest, CacheStats } from '../../../dependency/types';
import type { BuildCacheStorage, StorageOptions, CacheEntry } from './interface';
import { DEFAULT_STORAGE_OPTIONS, calculateManifestSize } from './interface';

// ============================================
// Error Classes
// ============================================

/**
 * Error thrown when cache storage fails to initialize.
 */
export class CacheInitializationError extends Error {
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'CacheInitializationError';
    this.cause = cause;
  }
}

/**
 * Error thrown when a cache operation fails.
 */
export class CacheOperationError extends Error {
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'CacheOperationError';
    this.cause = cause;
  }
}

/**
 * Error thrown when storage is accessed before initialization.
 */
export class StorageNotInitializedError extends Error {
  constructor() {
    super('Storage not initialized. Call initialize() first.');
    this.name = 'StorageNotInitializedError';
  }
}

/**
 * Options specific to filesystem storage.
 */
export interface FilesystemStorageOptions extends StorageOptions {
  /**
   * Base directory for cache files.
   * @default '.frontmcp-cache/builds'
   */
  cacheDir?: string;

  /**
   * File extension for cache files.
   * @default '.json'
   */
  extension?: string;
}

/**
 * Default filesystem storage options.
 */
const DEFAULT_FS_OPTIONS: Required<FilesystemStorageOptions> = {
  ...DEFAULT_STORAGE_OPTIONS,
  cacheDir: '.frontmcp-cache/builds',
  extension: '.json',
};

/**
 * Filesystem-based build cache storage.
 *
 * Stores each build manifest as a JSON file in the cache directory.
 * Uses LRU eviction based on last access time when size limits are exceeded.
 *
 * Directory structure:
 * ```
 * .frontmcp-cache/builds/
 *   ├── {hash1}.json
 *   ├── {hash2}.json
 *   └── ...
 * ```
 *
 * @example
 * ```typescript
 * const storage = new FilesystemStorage({
 *   cacheDir: '.cache/ui-builds',
 *   maxSize: 50 * 1024 * 1024, // 50MB
 * });
 *
 * await storage.initialize();
 * await storage.set('abc123', manifest);
 * const cached = await storage.get('abc123');
 * ```
 */
export class FilesystemStorage implements BuildCacheStorage {
  readonly type = 'filesystem';

  private readonly options: Required<FilesystemStorageOptions>;
  private initialized = false;
  private stats: CacheStats = {
    entries: 0,
    totalSize: 0,
    hits: 0,
    misses: 0,
    hitRate: 0,
  };

  constructor(options: FilesystemStorageOptions = {}) {
    this.options = {
      ...DEFAULT_FS_OPTIONS,
      ...options,
    };
  }

  /**
   * Initialize the storage directory.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await mkdir(this.options.cacheDir, { recursive: true });
      await this.loadStats();
      this.initialized = true;
    } catch (error) {
      throw new CacheInitializationError(`Failed to initialize cache directory: ${error}`, error);
    }
  }

  /**
   * Get a cached manifest.
   */
  async get(key: string): Promise<ComponentBuildManifest | undefined> {
    this.ensureInitialized();

    const filePath = this.getFilePath(key);

    try {
      if (!existsSync(filePath)) {
        this.stats.misses++;
        this.updateHitRate();
        return undefined;
      }

      const content = await readFile(filePath, 'utf8');
      const entry: CacheEntry = JSON.parse(content);

      // Check expiration
      if (Date.now() > entry.metadata.expiresAt) {
        await this.delete(key);
        this.stats.misses++;
        this.updateHitRate();
        return undefined;
      }

      // Update access metadata
      entry.metadata.lastAccessedAt = Date.now();
      entry.metadata.accessCount++;

      // Write back updated metadata (async, don't await)
      this.writeEntry(filePath, entry).catch((err) => {
        // Fire-and-forget write - log at debug level for visibility
        if (process.env['DEBUG']) {
          console.debug(`[FilesystemStorage] Failed to update cache metadata for ${key}: ${err}`);
        }
      });

      this.stats.hits++;
      this.updateHitRate();
      return entry.data;
    } catch {
      this.stats.misses++;
      this.updateHitRate();
      return undefined;
    }
  }

  /**
   * Store a manifest in cache.
   */
  async set(key: string, manifest: ComponentBuildManifest, ttl?: number): Promise<void> {
    this.ensureInitialized();

    const filePath = this.getFilePath(key);
    const size = calculateManifestSize(manifest);
    const effectiveTtl = ttl ?? this.options.defaultTtl;

    // Check if we need to evict entries
    await this.ensureCapacity(size);

    const entry: CacheEntry = {
      data: manifest,
      metadata: {
        key,
        size,
        createdAt: Date.now(),
        expiresAt: Date.now() + effectiveTtl * 1000,
        lastAccessedAt: Date.now(),
        accessCount: 0,
      },
    };

    await this.writeEntry(filePath, entry);

    this.stats.entries++;
    this.stats.totalSize += size;
  }

  /**
   * Check if a key exists.
   */
  async has(key: string): Promise<boolean> {
    this.ensureInitialized();

    const filePath = this.getFilePath(key);

    try {
      if (!existsSync(filePath)) return false;

      const content = await readFile(filePath, 'utf8');
      const entry: CacheEntry = JSON.parse(content);

      // Check expiration
      if (Date.now() > entry.metadata.expiresAt) {
        await this.delete(key);
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete a cached entry.
   */
  async delete(key: string): Promise<boolean> {
    this.ensureInitialized();

    const filePath = this.getFilePath(key);

    try {
      if (!existsSync(filePath)) return false;

      // Read to get size for stats
      const content = await readFile(filePath, 'utf8');
      const entry: CacheEntry = JSON.parse(content);

      await unlink(filePath);

      this.stats.entries = Math.max(0, this.stats.entries - 1);
      this.stats.totalSize = Math.max(0, this.stats.totalSize - entry.metadata.size);

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clear all cached entries.
   */
  async clear(): Promise<void> {
    this.ensureInitialized();

    try {
      await rm(this.options.cacheDir, { recursive: true, force: true });
      await mkdir(this.options.cacheDir, { recursive: true });

      this.stats = {
        entries: 0,
        totalSize: 0,
        hits: 0,
        misses: 0,
        hitRate: 0,
      };
    } catch (error) {
      throw new CacheOperationError(`Failed to clear cache: ${error}`, error);
    }
  }

  /**
   * Get cache statistics.
   */
  async getStats(): Promise<CacheStats> {
    return { ...this.stats };
  }

  /**
   * Clean up expired entries.
   */
  async cleanup(): Promise<number> {
    this.ensureInitialized();

    let removed = 0;

    try {
      const files = await readdir(this.options.cacheDir);

      for (const file of files) {
        if (!file.endsWith(this.options.extension)) continue;

        const filePath = join(this.options.cacheDir, file);

        try {
          const content = await readFile(filePath, 'utf8');
          const entry: CacheEntry = JSON.parse(content);

          if (Date.now() > entry.metadata.expiresAt) {
            await unlink(filePath);
            this.stats.entries = Math.max(0, this.stats.entries - 1);
            this.stats.totalSize = Math.max(0, this.stats.totalSize - entry.metadata.size);
            removed++;
          }
        } catch {
          // Corrupted file, remove it
          await unlink(filePath).catch(() => {
            /* ignore unlink errors */
          });
          removed++;
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }

    return removed;
  }

  /**
   * Close the storage (no-op for filesystem).
   */
  async close(): Promise<void> {
    // Nothing to close for filesystem storage
  }

  /**
   * Get the file path for a cache key.
   * Uses SHA-256 hash to avoid collisions from key sanitization.
   */
  private getFilePath(key: string): string {
    // Use hash to avoid collisions - different keys always produce different filenames
    const hash = createHash('sha256').update(key).digest('hex').slice(0, 16);
    return join(this.options.cacheDir, `${hash}${this.options.extension}`);
  }

  /**
   * Write a cache entry to disk.
   */
  private async writeEntry(filePath: string, entry: CacheEntry): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(entry, null, 2));
  }

  /**
   * Ensure the storage is initialized.
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new StorageNotInitializedError();
    }
  }

  /**
   * Load stats from existing cache files.
   * Reads entry metadata to get accurate manifest sizes.
   */
  private async loadStats(): Promise<void> {
    try {
      const files = await readdir(this.options.cacheDir);
      let entries = 0;
      let totalSize = 0;

      for (const file of files) {
        if (!file.endsWith(this.options.extension)) continue;

        const filePath = join(this.options.cacheDir, file);

        try {
          const content = await readFile(filePath, 'utf8');
          const entry: CacheEntry = JSON.parse(content);
          entries++;
          totalSize += entry.metadata.size;
        } catch {
          // Skip unreadable or corrupted files
        }
      }

      this.stats.entries = entries;
      this.stats.totalSize = totalSize;
    } catch {
      // Directory doesn't exist yet
    }
  }

  /**
   * Ensure there's capacity for a new entry.
   */
  private async ensureCapacity(newEntrySize: number): Promise<void> {
    // Check entry count limit
    if (this.stats.entries >= this.options.maxEntries) {
      await this.evictLRU();
    }

    // Check size limit
    while (this.stats.totalSize + newEntrySize > this.options.maxSize) {
      const evicted = await this.evictLRU();
      if (!evicted) break; // No more entries to evict
    }
  }

  /**
   * Evict the least recently used entry.
   */
  private async evictLRU(): Promise<boolean> {
    try {
      const files = await readdir(this.options.cacheDir);
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      let corruptedFile: string | null = null;

      for (const file of files) {
        if (!file.endsWith(this.options.extension)) continue;

        const filePath = join(this.options.cacheDir, file);

        try {
          const content = await readFile(filePath, 'utf8');
          const entry: CacheEntry = JSON.parse(content);

          if (entry.metadata.lastAccessedAt < oldestTime) {
            oldestTime = entry.metadata.lastAccessedAt;
            oldestKey = entry.metadata.key;
          }
        } catch {
          // Corrupted file, mark for direct removal
          corruptedFile = filePath;
        }
      }

      // Remove corrupted file directly if found
      if (corruptedFile) {
        try {
          await unlink(corruptedFile);
          this.stats.entries = Math.max(0, this.stats.entries - 1);
          return true;
        } catch {
          return false;
        }
      }

      // Delete oldest entry using the key from metadata
      if (oldestKey) {
        return await this.delete(oldestKey);
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Update hit rate statistic.
   */
  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }
}

/**
 * Create a filesystem storage instance.
 */
export function createFilesystemStorage(options?: FilesystemStorageOptions): FilesystemStorage {
  return new FilesystemStorage(options);
}
