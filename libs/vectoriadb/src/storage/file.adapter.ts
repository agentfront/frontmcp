import * as fs from 'fs/promises';
import * as path from 'path';
import type { DocumentMetadata } from '../interfaces';
import type { StorageAdapterConfig, StoredData } from './adapter.interface';
import { BaseStorageAdapter } from './base.adapter';
import { ConfigurationError, StorageError } from '../errors';

/**
 * Configuration for file storage adapter
 */
export interface FileStorageConfig extends StorageAdapterConfig {
  /**
   * Directory to store cache files
   * @default './.cache/vectoriadb'
   */
  cacheDir?: string;

  /**
   * File name for the cache
   * @default 'embeddings.json'
   */
  fileName?: string;
}

/**
 * File-based storage adapter
 * Stores embeddings in a JSON file with hash-based invalidation
 * Perfect for local development to avoid recalculating embeddings
 */
export class FileStorageAdapter<T extends DocumentMetadata = DocumentMetadata> extends BaseStorageAdapter<T> {
  private fileConfig: Required<Pick<FileStorageConfig, 'cacheDir' | 'fileName'>>;
  private filePath: string;

  constructor(config: FileStorageConfig = {}) {
    super(config);

    // Sanitize namespace to prevent path traversal
    const sanitizedNamespace = this.sanitizeNamespace(this.config.namespace);

    this.fileConfig = {
      cacheDir: config.cacheDir ?? './.cache/vectoriadb',
      fileName: config.fileName ?? 'embeddings.json',
    };

    this.filePath = path.join(this.fileConfig.cacheDir, sanitizedNamespace, this.fileConfig.fileName);

    // Verify the resolved path is still within cacheDir (path traversal protection)
    this.validateFilePath();
  }

  /**
   * Sanitize namespace to prevent path traversal attacks
   * Removes dangerous characters and path traversal sequences
   */
  private sanitizeNamespace(namespace: string): string {
    return (
      namespace
        // Remove path traversal sequences
        .replace(/\.\./g, '')
        // Replace path separators with hyphens
        .replace(/[/\\]/g, '-')
        // Remove leading dots and hyphens
        .replace(/^[.-]+/, '')
        // Remove trailing dots and hyphens
        .replace(/[.-]+$/, '')
        // Remove any remaining dangerous characters
        .replace(/[^a-zA-Z0-9-_]/g, '')
        // Limit length
        .substring(0, 100) || 'default'
    );
  }

  /**
   * Validate that the file path doesn't escape the cache directory
   */
  private validateFilePath(): void {
    const resolvedPath = path.resolve(this.filePath);
    const resolvedCacheDir = path.resolve(this.fileConfig.cacheDir);

    if (!resolvedPath.startsWith(resolvedCacheDir + path.sep) && resolvedPath !== resolvedCacheDir) {
      throw new ConfigurationError(
        `Invalid namespace: path traversal detected. ` + `Resolved path must be within cache directory.`,
      );
    }
  }

  override async initialize(): Promise<void> {
    // Ensure cache directory exists
    const dir = path.dirname(this.filePath);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      // With recursive:true, EEXIST shouldn't occur in modern Node.js
      // Surface real errors like permission denials or disk full
      throw new StorageError(
        `Failed to create cache directory: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  override async load(): Promise<StoredData<T> | null> {
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      return this.safeJsonParse<StoredData<T>>(content);
    } catch {
      // File doesn't exist or is invalid
      return null;
    }
  }

  override async save(data: StoredData<T>): Promise<void> {
    try {
      const content = this.safeJsonStringify(data, true);
      if (!content) {
        throw new StorageError('Failed to serialize embeddings data');
      }
      await fs.writeFile(this.filePath, content, 'utf-8');
    } catch (error) {
      if (error instanceof StorageError) {
        throw error;
      }
      throw new StorageError(
        `Failed to save embeddings to file: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  override async clear(): Promise<void> {
    try {
      await fs.unlink(this.filePath);
    } catch {
      // File doesn't exist, ignore
    }
  }

  override async close(): Promise<void> {
    // No cleanup needed for file adapter
  }
}
