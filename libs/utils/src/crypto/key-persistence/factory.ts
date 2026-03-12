/**
 * Factory functions for KeyPersistence.
 *
 * Provides convenient ways to create KeyPersistence instances
 * with auto-detection of storage backend.
 *
 * @module @frontmcp/utils/key-persistence
 */

import { isNode, isBrowser } from '../runtime';
import { MemoryStorageAdapter } from '../../storage/adapters/memory';
import type { StorageAdapter } from '../../storage/types';
import { KeyPersistence } from './key-persistence';
import type { CreateKeyPersistenceOptions } from './types';

/**
 * Default base directory for filesystem storage.
 */
const DEFAULT_BASE_DIR = '.frontmcp/keys';

/**
 * Create a KeyPersistence instance with auto-detected storage.
 *
 * In Node.js: Uses filesystem storage at `.frontmcp/keys/` by default
 * In browser: Uses IndexedDB (persistent) with localStorage fallback
 * Fallback: Memory storage (keys lost on restart)
 *
 * @param options - Configuration options
 * @returns KeyPersistence instance (storage already connected)
 *
 * @example
 * ```typescript
 * // Auto-detect storage
 * const keys = await createKeyPersistence();
 *
 * // Force memory storage
 * const memKeys = await createKeyPersistence({ type: 'memory' });
 *
 * // Force IndexedDB (browser)
 * const idbKeys = await createKeyPersistence({ type: 'indexeddb' });
 *
 * // Force localStorage (browser)
 * const lsKeys = await createKeyPersistence({ type: 'localstorage' });
 *
 * // Custom directory for filesystem
 * const fsKeys = await createKeyPersistence({
 *   type: 'filesystem',
 *   baseDir: '.my-app/keys',
 * });
 * ```
 */
export async function createKeyPersistence(options?: CreateKeyPersistenceOptions): Promise<KeyPersistence> {
  const type = options?.type ?? 'auto';
  const baseDir = options?.baseDir ?? DEFAULT_BASE_DIR;

  let adapter: StorageAdapter;

  if (type === 'memory') {
    adapter = new MemoryStorageAdapter();
  } else if (type === 'filesystem') {
    const { FileSystemStorageAdapter } = await import('../../storage/adapters/filesystem.js');
    adapter = new FileSystemStorageAdapter({ baseDir });
  } else if (type === 'indexeddb') {
    const { IndexedDBStorageAdapter } = await import('../../storage/adapters/indexeddb.js');
    adapter = new IndexedDBStorageAdapter();
  } else if (type === 'localstorage') {
    const { LocalStorageAdapter } = await import('../../storage/adapters/localstorage.js');
    adapter = new LocalStorageAdapter({ prefix: 'frontmcp:keys:' });
  } else {
    // Auto-detect
    if (isNode()) {
      const { FileSystemStorageAdapter } = await import('../../storage/adapters/filesystem.js');
      adapter = new FileSystemStorageAdapter({ baseDir });
    } else if (isBrowser() && typeof indexedDB !== 'undefined') {
      const { IndexedDBStorageAdapter } = await import('../../storage/adapters/indexeddb.js');
      adapter = new IndexedDBStorageAdapter();
    } else if (isBrowser() && typeof localStorage !== 'undefined') {
      const { LocalStorageAdapter } = await import('../../storage/adapters/localstorage.js');
      adapter = new LocalStorageAdapter({ prefix: 'frontmcp:keys:' });
    } else {
      adapter = new MemoryStorageAdapter();
    }
  }

  await adapter.connect();

  return new KeyPersistence({
    storage: adapter,
    throwOnInvalid: options?.throwOnInvalid ?? false,
    enableCache: options?.enableCache ?? true,
  });
}

/**
 * Create a KeyPersistence instance with an explicit storage adapter.
 *
 * Use this when you want to provide your own storage backend
 * (e.g., Redis, custom adapter).
 *
 * Note: The storage adapter must already be connected.
 *
 * @param storage - Connected storage adapter
 * @param options - Additional options
 * @returns KeyPersistence instance
 *
 * @example
 * ```typescript
 * import { createStorage } from '@frontmcp/utils';
 *
 * // Use Redis for distributed key storage
 * const redis = await createStorage({ type: 'redis' });
 * const keys = createKeyPersistenceWithStorage(redis);
 * ```
 */
export function createKeyPersistenceWithStorage(
  storage: StorageAdapter,
  options?: Pick<CreateKeyPersistenceOptions, 'throwOnInvalid' | 'enableCache'>,
): KeyPersistence {
  return new KeyPersistence({
    storage,
    throwOnInvalid: options?.throwOnInvalid ?? false,
    enableCache: options?.enableCache ?? true,
  });
}
