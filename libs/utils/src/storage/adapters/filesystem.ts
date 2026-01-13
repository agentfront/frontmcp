/**
 * Filesystem Storage Adapter
 *
 * File-based storage implementation for Node.js environments.
 * Each key is stored as a separate JSON file in a directory.
 *
 * **Node.js only** - throws an error if used in browser environments.
 *
 * @example
 * ```typescript
 * const adapter = new FileSystemStorageAdapter({
 *   baseDir: '.frontmcp/storage',
 * });
 *
 * await adapter.connect();
 * await adapter.set('user:123', JSON.stringify({ name: 'John' }));
 * const value = await adapter.get('user:123');
 * await adapter.disconnect();
 * ```
 */

import { BaseStorageAdapter } from './base';
import type { SetOptions } from '../types';
import { StorageOperationError } from '../errors';
import { globToRegex } from '../utils/pattern';
import { readFile, writeFile, readdir, unlink, fileExists, ensureDir, mkdir, rename, readJSON } from '../../fs';
import { randomBytes, bytesToHex } from '../../crypto';

/**
 * Options for FileSystemStorageAdapter.
 */
export interface FileSystemAdapterOptions {
  /**
   * Base directory for storage (absolute or relative to cwd).
   * Each key is stored as a file in this directory.
   */
  baseDir: string;

  /**
   * File extension for stored files.
   * @default '.json'
   */
  extension?: string;

  /**
   * Directory permissions (Unix mode).
   * @default 0o700
   */
  dirMode?: number;

  /**
   * File permissions (Unix mode).
   * @default 0o600
   */
  fileMode?: number;
}

/**
 * Internal structure for filesystem storage entries.
 */
interface FileEntry {
  value: string;
  expiresAt?: number;
}

/**
 * Filesystem-based storage adapter.
 *
 * Features:
 * - Persists data to individual JSON files
 * - Atomic writes using temp file + rename
 * - Restricted file permissions (0o600)
 * - TTL support with lazy expiration
 *
 * Limitations:
 * - No pub/sub support
 * - TTL not enforced with background sweeper
 * - Not suitable for high-throughput scenarios
 *
 * @example
 * ```typescript
 * import { FileSystemStorageAdapter } from '@frontmcp/utils';
 *
 * const adapter = new FileSystemStorageAdapter({
 *   baseDir: '.frontmcp/keys',
 *   extension: '.json',
 * });
 *
 * await adapter.connect();
 *
 * // Store data
 * await adapter.set('my-key', 'my-value');
 *
 * // Retrieve data
 * const value = await adapter.get('my-key');
 *
 * // List all keys
 * const keys = await adapter.keys();
 *
 * await adapter.disconnect();
 * ```
 */
export class FileSystemStorageAdapter extends BaseStorageAdapter {
  protected readonly backendName = 'filesystem';

  private readonly baseDir: string;
  private readonly extension: string;
  private readonly dirMode: number;
  private readonly fileMode: number;

  constructor(options: FileSystemAdapterOptions) {
    super();
    this.baseDir = options.baseDir;
    this.extension = options.extension ?? '.json';
    this.dirMode = options.dirMode ?? 0o700;
    this.fileMode = options.fileMode ?? 0o600;
  }

  // ============================================
  // Connection Lifecycle
  // ============================================

  async connect(): Promise<void> {
    if (this.connected) return;

    // Ensure base directory exists with proper permissions
    await ensureDir(this.baseDir);

    // Try to set directory permissions (may not work on all platforms)
    try {
      await mkdir(this.baseDir, { recursive: true, mode: this.dirMode });
    } catch {
      // Directory already exists, ignore error
    }

    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
  }

  async ping(): Promise<boolean> {
    if (!this.connected) return false;

    try {
      return await fileExists(this.baseDir);
    } catch {
      return false;
    }
  }

  // ============================================
  // Core Operations
  // ============================================

  async get(key: string): Promise<string | null> {
    this.ensureConnected();

    const filePath = this.keyToPath(key);

    try {
      const entry = await readJSON<FileEntry>(filePath);
      if (!entry) return null;

      // Check expiration
      if (entry.expiresAt && Date.now() >= entry.expiresAt) {
        await this.deleteFile(filePath);
        return null;
      }

      return entry.value;
    } catch (e) {
      const error = e as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        return null;
      }
      throw e;
    }
  }

  protected async doSet(key: string, value: string, options?: SetOptions): Promise<void> {
    const filePath = this.keyToPath(key);

    // Handle conditional flags
    const existingEntry = await this.readEntry(filePath);
    const exists = existingEntry !== null && !this.isExpired(existingEntry);

    if (options?.ifNotExists && exists) {
      return; // NX: Don't set if exists
    }
    if (options?.ifExists && !exists) {
      return; // XX: Don't set if doesn't exist
    }

    // Create entry
    const entry: FileEntry = { value };

    if (options?.ttlSeconds) {
      entry.expiresAt = Date.now() + options.ttlSeconds * 1000;
    }

    // Atomic write: write to temp file then rename
    await this.atomicWrite(filePath, entry);
  }

  async delete(key: string): Promise<boolean> {
    this.ensureConnected();

    const filePath = this.keyToPath(key);
    return this.deleteFile(filePath);
  }

  async exists(key: string): Promise<boolean> {
    this.ensureConnected();

    const filePath = this.keyToPath(key);

    try {
      const entry = await this.readEntry(filePath);
      if (!entry) return false;

      if (this.isExpired(entry)) {
        await this.deleteFile(filePath);
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  // ============================================
  // TTL Operations
  // ============================================

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    this.ensureConnected();

    const filePath = this.keyToPath(key);
    const entry = await this.readEntry(filePath);

    if (!entry || this.isExpired(entry)) {
      return false;
    }

    // Update expiration
    entry.expiresAt = Date.now() + ttlSeconds * 1000;
    await this.atomicWrite(filePath, entry);

    return true;
  }

  async ttl(key: string): Promise<number | null> {
    this.ensureConnected();

    const filePath = this.keyToPath(key);
    const entry = await this.readEntry(filePath);

    if (!entry) return null;

    if (this.isExpired(entry)) {
      await this.deleteFile(filePath);
      return null;
    }

    if (entry.expiresAt === undefined) {
      return -1; // No TTL
    }

    return Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
  }

  // ============================================
  // Key Enumeration
  // ============================================

  async keys(pattern = '*'): Promise<string[]> {
    this.ensureConnected();

    const regex = globToRegex(pattern);
    const result: string[] = [];

    try {
      const files = await readdir(this.baseDir);

      for (const file of files) {
        if (!file.endsWith(this.extension)) continue;

        const key = this.pathToKey(file);

        // Check if key matches pattern
        if (!regex.test(key)) continue;

        // Check expiration
        const filePath = this.keyToPath(key);
        const entry = await this.readEntry(filePath);

        if (entry && !this.isExpired(entry)) {
          result.push(key);
        } else if (entry && this.isExpired(entry)) {
          // Clean up expired entry
          await this.deleteFile(filePath);
        }
      }
    } catch (e) {
      const error = e as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        return [];
      }
      throw e;
    }

    return result;
  }

  // ============================================
  // Atomic Operations
  // ============================================

  async incr(key: string): Promise<number> {
    return this.incrBy(key, 1);
  }

  async decr(key: string): Promise<number> {
    return this.incrBy(key, -1);
  }

  async incrBy(key: string, amount: number): Promise<number> {
    this.ensureConnected();

    const filePath = this.keyToPath(key);
    const entry = await this.readEntry(filePath);

    let currentValue = 0;

    if (entry && !this.isExpired(entry)) {
      const parsed = parseInt(entry.value, 10);
      if (isNaN(parsed)) {
        throw new StorageOperationError('incrBy', key, 'Value is not an integer');
      }
      currentValue = parsed;
    }

    const newValue = currentValue + amount;

    // Preserve TTL if exists
    const newEntry: FileEntry = { value: String(newValue) };
    if (entry?.expiresAt && !this.isExpired(entry)) {
      newEntry.expiresAt = entry.expiresAt;
    }

    await this.atomicWrite(filePath, newEntry);

    return newValue;
  }

  // ============================================
  // Internal Helpers
  // ============================================

  /**
   * Convert a storage key to a file path.
   * Sanitizes the key to be filesystem-safe.
   */
  private keyToPath(key: string): string {
    // Encode the key to be filesystem-safe
    const safeKey = this.encodeKey(key);
    return `${this.baseDir}/${safeKey}${this.extension}`;
  }

  /**
   * Convert a filename back to a storage key.
   */
  private pathToKey(filename: string): string {
    const safeKey = filename.slice(0, -this.extension.length);
    return this.decodeKey(safeKey);
  }

  /**
   * Encode a key to be filesystem-safe.
   * Uses URL encoding to handle special characters.
   */
  private encodeKey(key: string): string {
    return encodeURIComponent(key).replace(/\./g, '%2E');
  }

  /**
   * Decode a filesystem-safe key back to original.
   */
  private decodeKey(encoded: string): string {
    return decodeURIComponent(encoded);
  }

  /**
   * Read an entry from a file.
   */
  private async readEntry(filePath: string): Promise<FileEntry | null> {
    try {
      return await readJSON<FileEntry>(filePath);
    } catch {
      return null;
    }
  }

  /**
   * Check if an entry is expired.
   */
  private isExpired(entry: FileEntry): boolean {
    return entry.expiresAt !== undefined && Date.now() >= entry.expiresAt;
  }

  /**
   * Delete a file, returning true if it existed.
   */
  private async deleteFile(filePath: string): Promise<boolean> {
    try {
      await unlink(filePath);
      return true;
    } catch (e) {
      const error = e as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        return false;
      }
      throw e;
    }
  }

  /**
   * Atomic write: write to temp file then rename.
   * This ensures we don't corrupt the file if write is interrupted.
   */
  private async atomicWrite(filePath: string, entry: FileEntry): Promise<void> {
    // Generate a random temp file name
    const tempSuffix = bytesToHex(randomBytes(8));
    const tempPath = `${filePath}.${tempSuffix}.tmp`;

    try {
      // Write to temp file with restricted permissions
      const content = JSON.stringify(entry, null, 2);
      await writeFile(tempPath, content, { mode: this.fileMode });

      // Rename to final path (atomic on most filesystems)
      await rename(tempPath, filePath);
    } catch (e) {
      // Clean up temp file on error
      try {
        await unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw e;
    }
  }

  /**
   * Get suggestion message for pub/sub not supported error.
   */
  protected override getPubSubSuggestion(): string {
    return 'FileSystem adapter does not support pub/sub. Use Redis or Memory adapter for pub/sub support.';
  }
}
