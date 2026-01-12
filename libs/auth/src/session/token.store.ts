/**
 * Token Store
 *
 * Interface for storing encrypted token blobs.
 *
 * For implementations, use StorageTokenStore with any storage adapter:
 *
 * @example
 * ```typescript
 * import { StorageTokenStore } from '@frontmcp/auth';
 * import { MemoryStorageAdapter, createStorage } from '@frontmcp/utils';
 *
 * // In-memory (development/testing)
 * const memoryAdapter = new MemoryStorageAdapter();
 * await memoryAdapter.connect();
 * const store = new StorageTokenStore(memoryAdapter);
 *
 * // With any backend (Redis, Vercel KV, Upstash)
 * const storage = await createStorage({ type: 'auto' });
 * const store = new StorageTokenStore(storage);
 * ```
 */

import type { EncBlob } from './token.vault';

export type SecretRecord = {
  id: string; // opaque reference id
  blob: EncBlob; // encrypted token
  updatedAt: number; // ms
};

export interface TokenStore {
  /** Create or overwrite a blob under a stable id. */
  put(id: string, blob: EncBlob): Promise<void>;
  /** Fetch encrypted blob by id. */
  get(id: string): Promise<SecretRecord | undefined>;
  /** Delete a reference. */
  del(id: string): Promise<void>;
  /** Allocate a new id (opaque). */
  allocId(): string;
}
