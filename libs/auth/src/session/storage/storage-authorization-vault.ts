/**
 * StorageAuthorizationVault
 *
 * AuthorizationVault implementation backed by @frontmcp/utils/storage adapters.
 * Supports Memory, Redis, Vercel KV, and Upstash backends.
 *
 * @example
 * ```typescript
 * import { createStorage } from '@frontmcp/utils/storage';
 * import { StorageAuthorizationVault } from '@frontmcp/auth';
 *
 * const storage = await createStorage({ type: 'auto' });
 * const vault = new StorageAuthorizationVault(storage);
 *
 * const entry = await vault.create({
 *   userSub: 'user123',
 *   clientId: 'client456',
 * });
 * ```
 */

import { randomUUID } from '@frontmcp/utils';
import type { StorageAdapter, NamespacedStorage } from '@frontmcp/utils';
import type {
  AuthorizationVault,
  AuthorizationVaultEntry,
  AppCredential,
  VaultConsentRecord,
  VaultFederatedRecord,
  PendingIncrementalAuth,
} from '../authorization-vault';
import { authorizationVaultEntrySchema } from '../authorization-vault';
import { TypedStorage } from './typed-storage';

/**
 * Options for StorageAuthorizationVault
 */
export interface StorageAuthorizationVaultOptions {
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

  /**
   * Whether to validate entries with Zod schema on read.
   * @default false
   */
  validateOnRead?: boolean;
}

/**
 * AuthorizationVault implementation using StorageAdapter.
 *
 * Stores complete AuthorizationVaultEntry documents as JSON blobs.
 * Supports all AuthorizationVault interface methods.
 */
export class StorageAuthorizationVault implements AuthorizationVault {
  private readonly storage: TypedStorage<AuthorizationVaultEntry>;
  private readonly namespace: string;
  private readonly pendingAuthTtlMs: number;

  constructor(storage: StorageAdapter | NamespacedStorage, options: StorageAuthorizationVaultOptions = {}) {
    this.namespace = options.namespace ?? 'vault';
    this.pendingAuthTtlMs = options.pendingAuthTtlMs ?? 10 * 60 * 1000;

    // Create a namespaced view if we have a NamespacedStorage
    const namespacedStorage = this.isNamespacedStorage(storage) ? storage.namespace(this.namespace) : storage;

    this.storage = new TypedStorage<AuthorizationVaultEntry>(namespacedStorage, {
      schema: options.validateOnRead ? authorizationVaultEntrySchema : undefined,
      throwOnInvalid: false,
    });
  }

  // ============================================
  // Core CRUD Methods
  // ============================================

  async create(params: {
    userSub: string;
    userEmail?: string;
    userName?: string;
    clientId: string;
    consent?: VaultConsentRecord;
    federated?: VaultFederatedRecord;
    authorizedAppIds?: string[];
    skippedAppIds?: string[];
  }): Promise<AuthorizationVaultEntry> {
    const now = Date.now();
    const entry: AuthorizationVaultEntry = {
      id: randomUUID(),
      userSub: params.userSub,
      userEmail: params.userEmail,
      userName: params.userName,
      clientId: params.clientId,
      createdAt: now,
      lastAccessAt: now,
      appCredentials: {},
      consent: params.consent,
      federated: params.federated,
      pendingAuths: [],
      authorizedAppIds: params.authorizedAppIds ?? [],
      skippedAppIds: params.skippedAppIds ?? [],
    };

    await this.storage.set(this.key(entry.id), entry);
    return entry;
  }

  async get(id: string): Promise<AuthorizationVaultEntry | null> {
    return this.storage.get(this.key(id));
  }

  async update(id: string, updates: Partial<AuthorizationVaultEntry>): Promise<void> {
    const entry = await this.get(id);
    if (!entry) {
      console.warn(`[StorageAuthorizationVault] Update failed: vault entry not found for id ${id}`);
      return;
    }

    const updated = {
      ...entry,
      ...updates,
      lastAccessAt: Date.now(),
    };
    await this.storage.set(this.key(id), updated);
  }

  async delete(id: string): Promise<void> {
    await this.storage.delete(this.key(id));
  }

  // ============================================
  // Consent Methods
  // ============================================

  async updateConsent(vaultId: string, consent: VaultConsentRecord): Promise<void> {
    const entry = await this.get(vaultId);
    if (!entry) return;

    entry.consent = consent;
    entry.lastAccessAt = Date.now();
    await this.storage.set(this.key(vaultId), entry);
  }

  // ============================================
  // App Authorization Methods
  // ============================================

  async authorizeApp(vaultId: string, appId: string): Promise<void> {
    const entry = await this.get(vaultId);
    if (!entry) return;

    // Remove from skipped, add to authorized
    entry.skippedAppIds = entry.skippedAppIds.filter((id) => id !== appId);
    if (!entry.authorizedAppIds.includes(appId)) {
      entry.authorizedAppIds.push(appId);
    }
    entry.lastAccessAt = Date.now();
    await this.storage.set(this.key(vaultId), entry);
  }

  async isAppAuthorized(vaultId: string, appId: string): Promise<boolean> {
    const entry = await this.get(vaultId);
    if (!entry) return false;

    return entry.authorizedAppIds.includes(appId);
  }

  // ============================================
  // Pending Auth Methods
  // ============================================

  async createPendingAuth(
    vaultId: string,
    params: {
      appId: string;
      toolId?: string;
      authUrl: string;
      requiredScopes?: string[];
      elicitId?: string;
      ttlMs?: number;
    },
  ): Promise<PendingIncrementalAuth> {
    const entry = await this.get(vaultId);
    if (!entry) {
      throw new Error(`Vault not found: ${vaultId}`);
    }

    const now = Date.now();
    const pendingAuth: PendingIncrementalAuth = {
      id: randomUUID(),
      appId: params.appId,
      toolId: params.toolId,
      authUrl: params.authUrl,
      requiredScopes: params.requiredScopes,
      elicitId: params.elicitId,
      createdAt: now,
      expiresAt: now + (params.ttlMs ?? this.pendingAuthTtlMs),
      status: 'pending',
    };

    entry.pendingAuths.push(pendingAuth);
    entry.lastAccessAt = now;
    await this.storage.set(this.key(vaultId), entry);

    return pendingAuth;
  }

  async getPendingAuth(vaultId: string, pendingAuthId: string): Promise<PendingIncrementalAuth | null> {
    const entry = await this.get(vaultId);
    if (!entry) return null;

    const pendingAuth = entry.pendingAuths.find((p) => p.id === pendingAuthId);
    if (!pendingAuth) return null;

    // Check if expired and update status
    if (Date.now() > pendingAuth.expiresAt && pendingAuth.status === 'pending') {
      pendingAuth.status = 'expired';
      await this.storage.set(this.key(vaultId), entry);
    }

    return pendingAuth;
  }

  async completePendingAuth(vaultId: string, pendingAuthId: string): Promise<void> {
    const entry = await this.get(vaultId);
    if (!entry) return;

    const pendingAuth = entry.pendingAuths.find((p) => p.id === pendingAuthId);
    if (pendingAuth) {
      pendingAuth.status = 'completed';

      // Auto-authorize the app
      entry.skippedAppIds = entry.skippedAppIds.filter((id) => id !== pendingAuth.appId);
      if (!entry.authorizedAppIds.includes(pendingAuth.appId)) {
        entry.authorizedAppIds.push(pendingAuth.appId);
      }

      entry.lastAccessAt = Date.now();
      await this.storage.set(this.key(vaultId), entry);
    }
  }

  async cancelPendingAuth(vaultId: string, pendingAuthId: string): Promise<void> {
    const entry = await this.get(vaultId);
    if (!entry) return;

    const pendingAuth = entry.pendingAuths.find((p) => p.id === pendingAuthId);
    if (pendingAuth) {
      pendingAuth.status = 'cancelled';
      await this.storage.set(this.key(vaultId), entry);
    }
  }

  async getPendingAuths(vaultId: string): Promise<PendingIncrementalAuth[]> {
    const entry = await this.get(vaultId);
    if (!entry) return [];

    const now = Date.now();
    let updated = false;

    const pending = entry.pendingAuths.filter((p) => {
      if (now > p.expiresAt && p.status === 'pending') {
        p.status = 'expired';
        updated = true;
      }
      return p.status === 'pending';
    });

    if (updated) {
      await this.storage.set(this.key(vaultId), entry);
    }

    return pending;
  }

  // ============================================
  // App Credential Methods
  // ============================================

  private credentialKey(appId: string, providerId: string): string {
    return `${appId}:${providerId}`;
  }

  async addAppCredential(vaultId: string, credential: AppCredential): Promise<void> {
    const entry = await this.get(vaultId);
    if (!entry) return;

    // Check if we should store based on consent
    const shouldStore = await this.shouldStoreCredential(vaultId, credential.appId);
    if (!shouldStore) {
      return;
    }

    const key = this.credentialKey(credential.appId, credential.providerId);
    entry.appCredentials[key] = credential;
    entry.lastAccessAt = Date.now();
    await this.storage.set(this.key(vaultId), entry);
  }

  async removeAppCredential(vaultId: string, appId: string, providerId: string): Promise<void> {
    const entry = await this.get(vaultId);
    if (!entry) return;

    const key = this.credentialKey(appId, providerId);
    delete entry.appCredentials[key];
    entry.lastAccessAt = Date.now();
    await this.storage.set(this.key(vaultId), entry);
  }

  async getAppCredentials(vaultId: string, appId: string): Promise<AppCredential[]> {
    const entry = await this.get(vaultId);
    if (!entry) return [];

    const prefix = `${appId}:`;
    return Object.entries(entry.appCredentials)
      .filter(([key]) => key.startsWith(prefix))
      .map(([, cred]) => cred);
  }

  async getCredential(vaultId: string, appId: string, providerId: string): Promise<AppCredential | null> {
    const entry = await this.get(vaultId);
    if (!entry) return null;

    const key = this.credentialKey(appId, providerId);
    return entry.appCredentials[key] ?? null;
  }

  async getAllCredentials(vaultId: string, filterByConsent = false): Promise<AppCredential[]> {
    const entry = await this.get(vaultId);
    if (!entry) return [];

    const allCredentials = Object.values(entry.appCredentials);

    if (!filterByConsent || !entry.consent?.enabled) {
      return allCredentials;
    }

    // Filter by consent - only return credentials for apps that have tools in consent selection
    const consentedToolIds = new Set(entry.consent.selectedToolIds);
    return allCredentials.filter((cred) => {
      return Array.from(consentedToolIds).some((toolId) => toolId.startsWith(`${cred.appId}:`));
    });
  }

  async updateCredential(
    vaultId: string,
    appId: string,
    providerId: string,
    updates: Partial<Pick<AppCredential, 'lastUsedAt' | 'isValid' | 'invalidReason' | 'expiresAt' | 'metadata'>>,
  ): Promise<void> {
    const entry = await this.get(vaultId);
    if (!entry) return;

    const key = this.credentialKey(appId, providerId);
    const credential = entry.appCredentials[key];
    if (!credential) return;

    Object.assign(credential, updates);
    entry.lastAccessAt = Date.now();
    await this.storage.set(this.key(vaultId), entry);
  }

  async shouldStoreCredential(vaultId: string, appId: string, toolIds?: string[]): Promise<boolean> {
    const entry = await this.get(vaultId);
    if (!entry) return false;

    // If consent is not enabled, always allow
    if (!entry.consent?.enabled) {
      return true;
    }

    // If toolIds provided, check if any match consent selection
    if (toolIds && toolIds.length > 0) {
      return toolIds.some((toolId) => entry.consent!.selectedToolIds.includes(toolId));
    }

    // Check if any tool for this app is in consent selection
    const consentedToolIds = entry.consent.selectedToolIds;
    return consentedToolIds.some((toolId) => toolId.startsWith(`${appId}:`));
  }

  async invalidateCredential(vaultId: string, appId: string, providerId: string, reason: string): Promise<void> {
    await this.updateCredential(vaultId, appId, providerId, {
      isValid: false,
      invalidReason: reason,
    });
  }

  async refreshOAuthCredential(
    vaultId: string,
    appId: string,
    providerId: string,
    tokens: { accessToken: string; refreshToken?: string; expiresAt?: number },
  ): Promise<void> {
    const entry = await this.get(vaultId);
    if (!entry) return;

    const key = this.credentialKey(appId, providerId);
    const credential = entry.appCredentials[key];
    if (!credential || (credential.credential.type !== 'oauth' && credential.credential.type !== 'oauth_pkce')) return;

    // Update OAuth tokens
    credential.credential.accessToken = tokens.accessToken;
    if (tokens.refreshToken !== undefined) {
      credential.credential.refreshToken = tokens.refreshToken;
    }
    if (tokens.expiresAt !== undefined) {
      credential.credential.expiresAt = tokens.expiresAt;
      credential.expiresAt = tokens.expiresAt;
    }

    // Mark as valid again
    credential.isValid = true;
    credential.invalidReason = undefined;
    entry.lastAccessAt = Date.now();
    await this.storage.set(this.key(vaultId), entry);
  }

  // ============================================
  // Cleanup
  // ============================================

  async cleanup(): Promise<void> {
    // For storage-based implementation, cleanup would need to iterate over all keys
    // This is expensive for large datasets, so we rely on in-document expiration checks
    // For production use, consider a scheduled cleanup job with cursor-based iteration
    const keys = await this.storage.keys('*');
    const now = Date.now();

    for (const key of keys) {
      const entry = await this.storage.get(key);
      if (!entry) continue;

      // Clean up expired pending auths
      const originalLength = entry.pendingAuths.length;
      entry.pendingAuths = entry.pendingAuths.filter((p) => {
        if (now > p.expiresAt && p.status === 'pending') {
          p.status = 'expired';
        }
        // Keep only pending auths
        return p.status === 'pending';
      });

      if (entry.pendingAuths.length !== originalLength) {
        await this.storage.set(key, entry);
      }
    }
  }

  // ============================================
  // Helpers
  // ============================================

  /**
   * Build the storage key for a vault ID.
   * For non-namespaced storage, includes the namespace prefix.
   */
  private key(id: string): string {
    return this.isNamespacedStorage(this.storage.raw) ? id : `${this.namespace}:${id}`;
  }

  /**
   * Type guard to check if storage is a NamespacedStorage.
   */
  private isNamespacedStorage(storage: StorageAdapter | NamespacedStorage): storage is NamespacedStorage {
    return 'namespace' in storage && typeof storage.namespace === 'function';
  }
}
