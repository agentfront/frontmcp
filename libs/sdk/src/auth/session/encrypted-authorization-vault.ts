/**
 * Encrypted Authorization Vault
 *
 * A vault implementation that encrypts all sensitive data using a key
 * derived from the client's JWT authorization token.
 *
 * Security Properties:
 * - Zero-knowledge storage: Server cannot decrypt credentials
 * - Client-side key: Encryption key derived from JWT (client must present token)
 * - Authenticated encryption: AES-256-GCM prevents tampering
 * - Per-vault keys: Each vault has a unique encryption key
 *
 * Usage:
 * ```typescript
 * const vault = new EncryptedRedisVault(redis, encryption);
 *
 * // On each request, derive key from JWT and set context
 * const key = encryption.deriveKeyFromToken(token, claims);
 * vault.setEncryptionKey(key);
 *
 * // Now all operations automatically encrypt/decrypt
 * await vault.addAppCredential(vaultId, credential);
 * ```
 */

import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { VaultEncryption, EncryptedData, VaultSensitiveData, encryptedDataSchema } from './vault-encryption';
import {
  AuthorizationVault,
  AuthorizationVaultEntry,
  AppCredential,
  ProviderToken,
  VaultConsentRecord,
  VaultFederatedRecord,
  PendingIncrementalAuth,
  authorizationVaultEntrySchema,
} from './authorization-vault';

// ============================================
// Encrypted Vault Entry Schema
// ============================================

/**
 * What we store in Redis - minimal metadata + encrypted blob
 */
export const redisVaultEntrySchema = z.object({
  /** Vault ID */
  id: z.string(),
  /** User sub (for lookup) */
  userSub: z.string(),
  /** User email (optional, for display) */
  userEmail: z.string().optional(),
  /** User name (optional, for display) */
  userName: z.string().optional(),
  /** Client ID */
  clientId: z.string(),
  /** Creation timestamp */
  createdAt: z.number(),
  /** Last access timestamp */
  lastAccessAt: z.number(),
  /** Authorized app IDs (unencrypted for quick auth checks) */
  authorizedAppIds: z.array(z.string()),
  /** Skipped app IDs (unencrypted for quick checks) */
  skippedAppIds: z.array(z.string()),
  /** Pending auth request IDs (unencrypted for lookup) */
  pendingAuthIds: z.array(z.string()),
  /** Encrypted sensitive data blob */
  encrypted: encryptedDataSchema,
});

export type RedisVaultEntry = z.infer<typeof redisVaultEntrySchema>;

// ============================================
// Encryption Context
// ============================================

/**
 * Encryption context for the current request
 * Must be set before performing vault operations
 */
export interface EncryptionContext {
  /** Encryption key derived from JWT */
  key: Buffer;
  /** Vault ID (from JWT jti claim) */
  vaultId: string;
}

// ============================================
// Encrypted Redis Vault Implementation
// ============================================

/**
 * Redis vault with client-side encryption
 *
 * All sensitive data (tokens, credentials, consent, pending auths)
 * is encrypted using a key derived from the client's JWT.
 */
export class EncryptedRedisVault implements AuthorizationVault {
  private encryptionContext: EncryptionContext | null = null;

  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly redis: any,
    private readonly encryption: VaultEncryption,
    private readonly namespace = 'vault:',
  ) {}

  /**
   * Set the encryption context for the current request
   * MUST be called before any vault operations
   *
   * @param key - Encryption key derived from JWT
   * @param vaultId - Vault ID (from JWT jti)
   */
  setEncryptionContext(key: Buffer, vaultId: string): void {
    this.encryptionContext = { key, vaultId };
  }

  /**
   * Clear the encryption context after request completes
   */
  clearEncryptionContext(): void {
    this.encryptionContext = null;
  }

  /**
   * Get current encryption key or throw
   */
  private getKey(): Buffer {
    if (!this.encryptionContext) {
      throw new Error('Encryption context not set. Call setEncryptionContext() first.');
    }
    return this.encryptionContext.key;
  }

  /**
   * Create Redis key from vault ID
   */
  private redisKey(id: string): string {
    return `${this.namespace}${id}`;
  }

  /**
   * Create credential key from appId and providerId
   */
  private credentialKey(appId: string, providerId: string): string {
    return `${appId}:${providerId}`;
  }

  /**
   * Encrypt sensitive data
   */
  private encryptSensitive(data: VaultSensitiveData): EncryptedData {
    return this.encryption.encryptObject(data, this.getKey());
  }

  /**
   * Decrypt sensitive data
   */
  private decryptSensitive(encrypted: EncryptedData): VaultSensitiveData {
    return this.encryption.decryptObject<VaultSensitiveData>(encrypted, this.getKey());
  }

  /**
   * Convert Redis entry to full vault entry (decrypts sensitive data)
   */
  private toVaultEntry(redisEntry: RedisVaultEntry): AuthorizationVaultEntry {
    const sensitive = this.decryptSensitive(redisEntry.encrypted);

    return {
      id: redisEntry.id,
      userSub: redisEntry.userSub,
      userEmail: redisEntry.userEmail,
      userName: redisEntry.userName,
      clientId: redisEntry.clientId,
      createdAt: redisEntry.createdAt,
      lastAccessAt: redisEntry.lastAccessAt,
      providerTokens: sensitive.providerTokens as Record<string, ProviderToken>,
      appCredentials: sensitive.appCredentials as Record<string, AppCredential>,
      consent: sensitive.consent as VaultConsentRecord | undefined,
      federated: sensitive.federated as VaultFederatedRecord | undefined,
      pendingAuths: sensitive.pendingAuths as PendingIncrementalAuth[],
      authorizedAppIds: redisEntry.authorizedAppIds,
      skippedAppIds: redisEntry.skippedAppIds,
    };
  }

  /**
   * Convert vault entry to Redis entry (encrypts sensitive data)
   */
  private toRedisEntry(entry: AuthorizationVaultEntry): RedisVaultEntry {
    const sensitive: VaultSensitiveData = {
      providerTokens: entry.providerTokens,
      appCredentials: entry.appCredentials,
      consent: entry.consent,
      federated: entry.federated,
      pendingAuths: entry.pendingAuths,
    };

    return {
      id: entry.id,
      userSub: entry.userSub,
      userEmail: entry.userEmail,
      userName: entry.userName,
      clientId: entry.clientId,
      createdAt: entry.createdAt,
      lastAccessAt: entry.lastAccessAt,
      authorizedAppIds: entry.authorizedAppIds,
      skippedAppIds: entry.skippedAppIds,
      pendingAuthIds: entry.pendingAuths.map((p) => p.id),
      encrypted: this.encryptSensitive(sensitive),
    };
  }

  /**
   * Save entry to Redis
   */
  private async saveEntry(entry: AuthorizationVaultEntry): Promise<void> {
    const redisEntry = this.toRedisEntry(entry);
    await this.redis.set(this.redisKey(entry.id), JSON.stringify(redisEntry));
  }

  /**
   * Load entry from Redis
   */
  private async loadEntry(id: string): Promise<AuthorizationVaultEntry | null> {
    const data = await this.redis.get(this.redisKey(id));
    if (!data) return null;

    try {
      const redisEntry = redisVaultEntrySchema.parse(JSON.parse(data));
      return this.toVaultEntry(redisEntry);
    } catch (error) {
      // Could be decryption failure (wrong key) or corrupt data
      throw new Error(`Failed to load vault ${id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // ============================================
  // AuthorizationVault Interface Implementation
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
      providerTokens: {},
      appCredentials: {},
      consent: params.consent,
      federated: params.federated,
      pendingAuths: [],
      authorizedAppIds: params.authorizedAppIds ?? [],
      skippedAppIds: params.skippedAppIds ?? [],
    };

    await this.saveEntry(entry);
    return entry;
  }

  async get(id: string): Promise<AuthorizationVaultEntry | null> {
    const entry = await this.loadEntry(id);
    if (!entry) return null;

    // Update last access time
    entry.lastAccessAt = Date.now();
    await this.saveEntry(entry);

    return entry;
  }

  async update(id: string, updates: Partial<AuthorizationVaultEntry>): Promise<void> {
    const entry = await this.loadEntry(id);
    if (!entry) return;

    Object.assign(entry, updates, { lastAccessAt: Date.now() });
    await this.saveEntry(entry);
  }

  async delete(id: string): Promise<void> {
    await this.redis.del(this.redisKey(id));
  }

  async addProviderToken(vaultId: string, token: ProviderToken): Promise<void> {
    const entry = await this.loadEntry(vaultId);
    if (!entry) return;

    entry.providerTokens[token.providerId] = token;
    entry.lastAccessAt = Date.now();
    await this.saveEntry(entry);
  }

  async removeProviderToken(vaultId: string, providerId: string): Promise<void> {
    const entry = await this.loadEntry(vaultId);
    if (!entry) return;

    delete entry.providerTokens[providerId];
    entry.lastAccessAt = Date.now();
    await this.saveEntry(entry);
  }

  async updateConsent(vaultId: string, consent: VaultConsentRecord): Promise<void> {
    const entry = await this.loadEntry(vaultId);
    if (!entry) return;

    entry.consent = consent;
    entry.lastAccessAt = Date.now();
    await this.saveEntry(entry);
  }

  async authorizeApp(vaultId: string, appId: string): Promise<void> {
    const entry = await this.loadEntry(vaultId);
    if (!entry) return;

    entry.skippedAppIds = entry.skippedAppIds.filter((id) => id !== appId);
    if (!entry.authorizedAppIds.includes(appId)) {
      entry.authorizedAppIds.push(appId);
    }
    entry.lastAccessAt = Date.now();
    await this.saveEntry(entry);
  }

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
    const entry = await this.loadEntry(vaultId);
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
      expiresAt: now + (params.ttlMs ?? 10 * 60 * 1000),
      status: 'pending',
    };

    entry.pendingAuths.push(pendingAuth);
    entry.lastAccessAt = now;
    await this.saveEntry(entry);

    return pendingAuth;
  }

  async getPendingAuth(vaultId: string, pendingAuthId: string): Promise<PendingIncrementalAuth | null> {
    const entry = await this.loadEntry(vaultId);
    if (!entry) return null;

    const pendingAuth = entry.pendingAuths.find((p) => p.id === pendingAuthId);
    if (!pendingAuth) return null;

    if (Date.now() > pendingAuth.expiresAt && pendingAuth.status === 'pending') {
      pendingAuth.status = 'expired';
      await this.saveEntry(entry);
    }

    return pendingAuth;
  }

  async completePendingAuth(vaultId: string, pendingAuthId: string): Promise<void> {
    const entry = await this.loadEntry(vaultId);
    if (!entry) return;

    const pendingAuth = entry.pendingAuths.find((p) => p.id === pendingAuthId);
    if (pendingAuth) {
      pendingAuth.status = 'completed';

      // Authorize app inline (don't call authorizeApp which reloads entry)
      entry.skippedAppIds = entry.skippedAppIds.filter((id) => id !== pendingAuth.appId);
      if (!entry.authorizedAppIds.includes(pendingAuth.appId)) {
        entry.authorizedAppIds.push(pendingAuth.appId);
      }
      entry.lastAccessAt = Date.now();
      await this.saveEntry(entry);
    }
  }

  async cancelPendingAuth(vaultId: string, pendingAuthId: string): Promise<void> {
    const entry = await this.loadEntry(vaultId);
    if (!entry) return;

    const pendingAuth = entry.pendingAuths.find((p) => p.id === pendingAuthId);
    if (pendingAuth) {
      pendingAuth.status = 'cancelled';
      await this.saveEntry(entry);
    }
  }

  async isAppAuthorized(vaultId: string, appId: string): Promise<boolean> {
    // Quick check without decryption - authorizedAppIds is unencrypted
    const data = await this.redis.get(this.redisKey(vaultId));
    if (!data) return false;

    try {
      const parsed = JSON.parse(data);
      return Array.isArray(parsed.authorizedAppIds) && parsed.authorizedAppIds.includes(appId);
    } catch {
      return false;
    }
  }

  async getPendingAuths(vaultId: string): Promise<PendingIncrementalAuth[]> {
    const entry = await this.loadEntry(vaultId);
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
      await this.saveEntry(entry);
    }

    return pending;
  }

  // ============================================
  // App Credential Methods
  // ============================================

  async addAppCredential(vaultId: string, credential: AppCredential): Promise<void> {
    const entry = await this.loadEntry(vaultId);
    if (!entry) return;

    const shouldStore = await this.shouldStoreCredential(vaultId, credential.appId);
    if (!shouldStore) return;

    const key = this.credentialKey(credential.appId, credential.providerId);
    entry.appCredentials[key] = credential;
    entry.lastAccessAt = Date.now();
    await this.saveEntry(entry);
  }

  async removeAppCredential(vaultId: string, appId: string, providerId: string): Promise<void> {
    const entry = await this.loadEntry(vaultId);
    if (!entry) return;

    const key = this.credentialKey(appId, providerId);
    delete entry.appCredentials[key];
    entry.lastAccessAt = Date.now();
    await this.saveEntry(entry);
  }

  async getAppCredentials(vaultId: string, appId: string): Promise<AppCredential[]> {
    const entry = await this.loadEntry(vaultId);
    if (!entry) return [];

    const prefix = `${appId}:`;
    return Object.entries(entry.appCredentials)
      .filter(([key]) => key.startsWith(prefix))
      .map(([, cred]) => cred);
  }

  async getCredential(vaultId: string, appId: string, providerId: string): Promise<AppCredential | null> {
    const entry = await this.loadEntry(vaultId);
    if (!entry) return null;

    const key = this.credentialKey(appId, providerId);
    return entry.appCredentials[key] ?? null;
  }

  async getAllCredentials(vaultId: string, filterByConsent = false): Promise<AppCredential[]> {
    const entry = await this.loadEntry(vaultId);
    if (!entry) return [];

    const allCredentials = Object.values(entry.appCredentials);

    if (!filterByConsent || !entry.consent?.enabled) {
      return allCredentials;
    }

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
    const entry = await this.loadEntry(vaultId);
    if (!entry) return;

    const key = this.credentialKey(appId, providerId);
    const credential = entry.appCredentials[key];
    if (!credential) return;

    Object.assign(credential, updates);
    entry.lastAccessAt = Date.now();
    await this.saveEntry(entry);
  }

  async shouldStoreCredential(vaultId: string, appId: string, toolIds?: string[]): Promise<boolean> {
    const entry = await this.loadEntry(vaultId);
    if (!entry) return false;

    if (!entry.consent?.enabled) {
      return true;
    }

    if (toolIds && toolIds.length > 0) {
      return toolIds.some((toolId) => entry.consent!.selectedToolIds.includes(toolId));
    }

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
    const entry = await this.loadEntry(vaultId);
    if (!entry) return;

    const key = this.credentialKey(appId, providerId);
    const credential = entry.appCredentials[key];
    if (!credential || credential.credential.type !== 'oauth') return;

    // Update OAuth tokens
    credential.credential.accessToken = tokens.accessToken;
    if (tokens.refreshToken !== undefined) {
      credential.credential.refreshToken = tokens.refreshToken;
    }
    if (tokens.expiresAt !== undefined) {
      credential.credential.expiresAt = tokens.expiresAt;
      credential.expiresAt = tokens.expiresAt;
    }

    credential.isValid = true;
    credential.invalidReason = undefined;
    entry.lastAccessAt = Date.now();
    await this.saveEntry(entry);
  }

  async cleanup(): Promise<void> {
    // Redis cleanup would use SCAN to find and clean entries
    // For encrypted vault, this needs careful handling
    // as we can't read data without the encryption key
  }
}

// ============================================
// Factory Function
// ============================================

/**
 * Create an encrypted vault with the given configuration
 */
export function createEncryptedVault(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  redis: any,
  config: {
    pepper?: string;
    namespace?: string;
  } = {},
): { vault: EncryptedRedisVault; encryption: VaultEncryption } {
  const encryption = new VaultEncryption({ pepper: config.pepper });
  const vault = new EncryptedRedisVault(redis, encryption, config.namespace);

  return { vault, encryption };
}
