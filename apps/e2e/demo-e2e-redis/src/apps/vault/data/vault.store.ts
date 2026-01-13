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
    try {
      const storage = new MemoryStorageAdapter();
      await storage.connect(); // Connect the adapter
      storageInstances.set(sessionId, storage);

      const vault = new StorageAuthorizationVault(storage, {
        namespace: 'vault',
        pendingAuthTtlMs: 60000, // 1 minute for testing
        validateOnRead: false, // Disable for simpler testing
      });

      vaultInstances.set(sessionId, vault);
      return vault;
    } finally {
      initPromises.delete(sessionId);
    }
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
 * Clear all vault instances and disconnect storage adapters
 */
export async function clearAllVaults(): Promise<void> {
  // Snapshot and clear in-flight initializations first to prevent race conditions
  const pendingInits = Array.from(initPromises.values());
  initPromises.clear();

  // Wait for any in-flight initializations to complete (they will clean up after themselves)
  await Promise.allSettled(pendingInits);

  // Disconnect all storage adapters before clearing
  const disconnectPromises: Promise<void>[] = [];
  for (const storage of storageInstances.values()) {
    disconnectPromises.push(storage.disconnect());
  }
  await Promise.all(disconnectPromises);

  vaultInstances.clear();
  storageInstances.clear();
}
