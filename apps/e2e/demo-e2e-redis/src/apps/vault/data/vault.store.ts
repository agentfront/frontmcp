/**
 * Vault Store - In-memory storage adapter for StorageAuthorizationVault testing
 *
 * Uses MemoryStorageAdapter from @frontmcp/utils
 */
import { MemoryStorageAdapter } from '@frontmcp/utils';
import { StorageAuthorizationVault } from '@frontmcp/auth';

// Singleton instances per session
const vaultInstances = new Map<string, StorageAuthorizationVault>();
const storageInstances = new Map<string, MemoryStorageAdapter>();
const initPromises = new Map<string, Promise<StorageAuthorizationVault>>();

/**
 * Get the StorageAuthorizationVault for a session
 */
export async function getVault(sessionId: string): Promise<StorageAuthorizationVault> {
  // Return existing vault if already initialized
  const existingVault = vaultInstances.get(sessionId);
  if (existingVault) {
    return existingVault;
  }

  // Check if initialization is already in progress
  const existingPromise = initPromises.get(sessionId);
  if (existingPromise) {
    return existingPromise;
  }

  // Create initialization promise
  const initPromise = (async () => {
    const storage = new MemoryStorageAdapter();
    await storage.connect(); // Connect the adapter
    storageInstances.set(sessionId, storage);

    const vault = new StorageAuthorizationVault(storage, {
      namespace: 'vault',
      pendingAuthTtlMs: 60000, // 1 minute for testing
      validateOnRead: false, // Disable for simpler testing
    });

    vaultInstances.set(sessionId, vault);
    initPromises.delete(sessionId);
    return vault;
  })();

  initPromises.set(sessionId, initPromise);
  return initPromise;
}

/**
 * Get the storage adapter for a session (for debugging/inspection)
 */
export function getStorage(sessionId: string): MemoryStorageAdapter | undefined {
  return storageInstances.get(sessionId);
}

/**
 * Clear all vault instances
 */
export function clearAllVaults(): void {
  vaultInstances.clear();
  storageInstances.clear();
}
