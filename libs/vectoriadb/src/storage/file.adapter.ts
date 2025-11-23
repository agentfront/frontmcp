import * as fs from 'fs/promises';
import * as path from 'path';
import type { DocumentMetadata } from '../interfaces';
import type { StorageAdapter, StorageAdapterConfig, StoredData, StorageMetadata } from './adapter.interface';

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
export class FileStorageAdapter<T extends DocumentMetadata = DocumentMetadata> implements StorageAdapter<T> {
  private config: Required<FileStorageConfig>;
  private filePath: string;

  constructor(config: FileStorageConfig = {}) {
    this.config = {
      namespace: config.namespace ?? 'default',
      autoSave: config.autoSave ?? false,
      autoSaveInterval: config.autoSaveInterval ?? 60000,
      cacheDir: config.cacheDir ?? './.cache/vectoriadb',
      fileName: config.fileName ?? 'embeddings.json',
    };

    this.filePath = path.join(this.config.cacheDir, this.config.namespace, this.config.fileName);
  }

  async initialize(): Promise<void> {
    // Ensure cache directory exists
    const dir = path.dirname(this.filePath);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      // Directory might already exist, ignore error
    }
  }

  async hasValidCache(metadata: StorageMetadata): Promise<boolean> {
    try {
      const data = await this.load();
      if (!data) {
        return false;
      }

      // Check if version matches
      if (data.metadata.version !== metadata.version) {
        return false;
      }

      // Check if tools hash matches (invalidate if tools changed)
      if (data.metadata.toolsHash !== metadata.toolsHash) {
        return false;
      }

      // Check if model name matches
      if (data.metadata.modelName !== metadata.modelName) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  async load(): Promise<StoredData<T> | null> {
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      const data = JSON.parse(content) as StoredData<T>;
      return data;
    } catch (error) {
      // File doesn't exist or is invalid
      return null;
    }
  }

  async save(data: StoredData<T>): Promise<void> {
    try {
      const content = JSON.stringify(data, null, 2);
      await fs.writeFile(this.filePath, content, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to save embeddings to file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async clear(): Promise<void> {
    try {
      await fs.unlink(this.filePath);
    } catch {
      // File doesn't exist, ignore
    }
  }

  async close(): Promise<void> {
    // No cleanup needed for file adapter
  }
}
