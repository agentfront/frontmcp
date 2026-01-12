/**
 * In-Memory Authorization Vault
 *
 * Development/testing implementation using MemoryStorageAdapter.
 * Data is lost on restart.
 *
 * For production, use StorageAuthorizationVault with a persistent
 * storage adapter (Redis, Vercel KV, Upstash, etc.).
 *
 * @example
 * ```typescript
 * const vault = new InMemoryAuthorizationVault();
 * const entry = await vault.create({
 *   userSub: 'user123',
 *   clientId: 'client456',
 * });
 * ```
 */

import { MemoryStorageAdapter } from '@frontmcp/utils';
import { StorageAuthorizationVault, type StorageAuthorizationVaultOptions } from './storage-authorization-vault';

/**
 * Options for InMemoryAuthorizationVault
 */
export interface InMemoryAuthorizationVaultOptions {
  /**
   * Namespace prefix for all keys.
   * @default 'vault'
   */
  namespace?: string;

  /**
   * Default TTL for pending auth requests in milliseconds.
   * @default 600000 (10 minutes)
   */
  pendingAuthTtlMs?: number;
}

/**
 * In-Memory Authorization Vault
 *
 * Development/testing implementation using MemoryStorageAdapter.
 * Data is lost on restart.
 *
 * For production, use StorageAuthorizationVault with a persistent
 * storage adapter (Redis, Vercel KV, Upstash, etc.).
 */
export class InMemoryAuthorizationVault extends StorageAuthorizationVault {
  private readonly memoryAdapter: MemoryStorageAdapter;

  constructor(options: InMemoryAuthorizationVaultOptions = {}) {
    const memoryAdapter = new MemoryStorageAdapter();
    super(memoryAdapter, {
      namespace: options.namespace ?? 'vault',
      pendingAuthTtlMs: options.pendingAuthTtlMs,
    });
    this.memoryAdapter = memoryAdapter;

    // Connect the adapter (memory adapter connect is instant and synchronous)
    void this.memoryAdapter.connect();
  }

  /**
   * Clear all stored data.
   * Useful for testing.
   */
  async clear(): Promise<void> {
    const keys = await this.memoryAdapter.keys('*');
    for (const key of keys) {
      await this.memoryAdapter.delete(key);
    }
  }
}
