/**
 * Factory functions for KeyPersistence.
 *
 * Provides convenient ways to create KeyPersistence instances
 * with auto-detection of storage backend.
 *
 * @module @frontmcp/utils/key-persistence
 */

import { MemoryStorageAdapter } from '../../storage/adapters/memory';
import type { StorageAdapter } from '../../storage/types';
import { isBrowser, isNode } from '../runtime';
import { KeyPersistence } from './key-persistence';
import { LocalStorageKeyRequiredError, LocalStorageKeyUnavailableError } from './local-storage-key';
import type { CreateKeyPersistenceOptions } from './types';

/**
 * Default base directory for filesystem storage.
 */
const DEFAULT_BASE_DIR = '.frontmcp/keys';

let keysInMemoryWarned = false;

async function createLocalStorageKeyAdapter(encryptionKey?: Uint8Array): Promise<StorageAdapter> {
  const records = await import('./local-storage-key-records.js');
  return records.createLocalStorageKeyAdapter(encryptionKey);
}

/** For 'auto': localStorage key records, else memory; a refusal to read the records already there is passed on. */
async function localStorageKeysOrMemory(encryptionKey?: Uint8Array): Promise<StorageAdapter> {
  try {
    return await createLocalStorageKeyAdapter(encryptionKey);
  } catch (error) {
    if (error instanceof LocalStorageKeyUnavailableError) throw error;
    if (error instanceof LocalStorageKeyRequiredError && !keysInMemoryWarned) {
      keysInMemoryWarned = true;
      console.warn(
        '[frontmcp] createKeyPersistence: IndexedDB or WebCrypto is unavailable and no encryptionKey was given, so ' +
          'keys are kept in memory only. Pass encryptionKey, a 32-byte key kept outside localStorage, to keep them.',
      );
    }
    return new MemoryStorageAdapter();
  }
}

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
    adapter = new IndexedDBStorageAdapter({ prefix: 'frontmcp:keys:' });
  } else if (type === 'localstorage') {
    adapter = await createLocalStorageKeyAdapter(options?.encryptionKey);
  } else {
    // Auto-detect with fallback chain: filesystem → indexeddb → localStorage → memory
    let connected = false;

    if (isNode()) {
      try {
        const { FileSystemStorageAdapter } = await import('../../storage/adapters/filesystem.js');
        adapter = new FileSystemStorageAdapter({ baseDir });
        await adapter.connect();
        connected = true;
      } catch {
        adapter = new MemoryStorageAdapter();
      }
    } else if (isBrowser() && typeof indexedDB !== 'undefined') {
      try {
        const { IndexedDBStorageAdapter } = await import('../../storage/adapters/indexeddb.js');
        adapter = new IndexedDBStorageAdapter({ prefix: 'frontmcp:keys:' });
        await adapter.connect();
        connected = true;
      } catch {
        // Fall through to localStorage
        adapter =
          typeof localStorage !== 'undefined'
            ? await localStorageKeysOrMemory(options?.encryptionKey)
            : new MemoryStorageAdapter();
      }
    } else if (isBrowser() && typeof localStorage !== 'undefined') {
      adapter = await localStorageKeysOrMemory(options?.encryptionKey);
    } else {
      adapter = new MemoryStorageAdapter();
    }

    if (!connected) {
      await adapter.connect();
    }
  }

  if (type !== 'auto') {
    await adapter.connect();
  }

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
