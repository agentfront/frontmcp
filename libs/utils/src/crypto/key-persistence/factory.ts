/**
 * Factory functions for KeyPersistence.
 *
 * Provides convenient ways to create KeyPersistence instances
 * with auto-detection of storage backend.
 *
 * @module @frontmcp/utils/key-persistence
 */

import { isNode, isBrowser } from '../runtime';
import { cryptoProvider } from '#crypto-provider';
import { MemoryStorageAdapter } from '../../storage/adapters/memory';
import type { StorageAdapter } from '../../storage/types';
import { KeyPersistence } from './key-persistence';
import type { CreateKeyPersistenceOptions } from './types';
import { randomBytes, base64urlEncode, base64urlDecode } from '../index';

/**
 * Default base directory for filesystem storage.
 */
const DEFAULT_BASE_DIR = '.frontmcp/keys';

const LS_HKDF_IKM = new TextEncoder().encode('frontmcp:localstorage:v1');
const INSTALL_SALT_KEY = '__frontmcp_internal__:install_salt';
const LEGACY_SALT_KEY = 'frontmcp:_install_salt';

/**
 * Get or create a per-installation random salt stored in localStorage.
 * This ensures the derived key is unique per browser installation.
 */
function getOrCreateInstallationSalt(): Uint8Array {
  if (typeof localStorage === 'undefined') {
    throw new Error('localStorage unavailable: cannot derive installation salt');
  }
  const existing = localStorage.getItem(INSTALL_SALT_KEY);
  if (existing) {
    try {
      return base64urlDecode(existing);
    } catch {
      // Corrupted salt — regenerate
    }
  }

  // Migrate from legacy key if present
  const legacy = localStorage.getItem(LEGACY_SALT_KEY);
  if (legacy) {
    try {
      const salt = base64urlDecode(legacy);
      localStorage.setItem(INSTALL_SALT_KEY, base64urlEncode(salt));
      localStorage.removeItem(LEGACY_SALT_KEY);
      return salt;
    } catch {
      localStorage.removeItem(LEGACY_SALT_KEY);
    }
  }

  const salt = randomBytes(32);
  localStorage.setItem(INSTALL_SALT_KEY, base64urlEncode(salt));
  return salt;
}

/**
 * Derive or pass-through a 32-byte AES-256-GCM key for localStorage encryption.
 * Uses HKDF-SHA256 with a fixed IKM, per-installation salt, and `location.origin` as info context.
 */
function deriveLocalStorageKey(userKey?: Uint8Array): Uint8Array {
  if (userKey) return userKey;
  const salt = getOrCreateInstallationSalt();
  const origin = typeof location !== 'undefined' ? location.origin : 'unknown';
  const info = new TextEncoder().encode(origin);
  return cryptoProvider.hkdfSha256(LS_HKDF_IKM, salt, info, 32);
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
    const { LocalStorageAdapter } = await import('../../storage/adapters/localstorage.js');
    adapter = new LocalStorageAdapter({
      prefix: 'frontmcp:keys:',
      encryptionKey: deriveLocalStorageKey(options?.encryptionKey),
    });
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
        if (typeof localStorage !== 'undefined') {
          try {
            const { LocalStorageAdapter } = await import('../../storage/adapters/localstorage.js');
            adapter = new LocalStorageAdapter({
              prefix: 'frontmcp:keys:',
              encryptionKey: deriveLocalStorageKey(options?.encryptionKey),
            });
            await adapter.connect();
            connected = true;
          } catch {
            adapter = new MemoryStorageAdapter();
          }
        } else {
          adapter = new MemoryStorageAdapter();
        }
      }
    } else if (isBrowser() && typeof localStorage !== 'undefined') {
      try {
        const { LocalStorageAdapter } = await import('../../storage/adapters/localstorage.js');
        adapter = new LocalStorageAdapter({
          prefix: 'frontmcp:keys:',
          encryptionKey: deriveLocalStorageKey(options?.encryptionKey),
        });
        await adapter.connect();
        connected = true;
      } catch {
        adapter = new MemoryStorageAdapter();
      }
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
