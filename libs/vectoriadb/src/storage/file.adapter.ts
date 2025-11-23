import * as fs from 'fs/promises';
import * as path from 'path';
import type { DocumentMetadata } from '../interfaces';
import type { StorageAdapterConfig, StoredData } from './adapter.interface';
import { BaseStorageAdapter } from './base.adapter';

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

    this.fileConfig = {
      cacheDir: config.cacheDir ?? './.cache/vectoriadb',
      fileName: config.fileName ?? 'embeddings.json',
    };

    this.filePath = path.join(this.fileConfig.cacheDir, this.config.namespace, this.fileConfig.fileName);
  }

  override async initialize(): Promise<void> {
    // Ensure cache directory exists
    const dir = path.dirname(this.filePath);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      // Directory might already exist, ignore error
    }
  }

  override async load(): Promise<StoredData<T> | null> {
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      return this.safeJsonParse<StoredData<T>>(content);
    } catch (error) {
      // File doesn't exist or is invalid
      return null;
    }
  }

  override async save(data: StoredData<T>): Promise<void> {
    try {
      const content = this.safeJsonStringify(data, true);
      if (!content) {
        throw new Error('Failed to serialize embeddings data');
      }
      await fs.writeFile(this.filePath, content, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to save embeddings to file: ${error instanceof Error ? error.message : String(error)}`);
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
