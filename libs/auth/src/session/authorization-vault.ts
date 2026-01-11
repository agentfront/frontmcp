/**
 * Authorization Vault
 *
 * Secure storage for stateful authorization sessions.
 * Stores provider tokens, consent selections, and session metadata.
 *
 * Supports multiple credential types:
 * - OAuth tokens (access_token, refresh_token, scopes)
 * - API Keys (key value, header name)
 * - Basic Auth (username, password)
 * - Private Keys (PEM/JWK format for signing)
 * - Custom credentials (extensible)
 *
 * In stateful mode:
 * - Access token is a non-rotatable key to this vault
 * - All sensitive data stored server-side
 * - Supports incremental authorization via links
 *
 * In stateless mode:
 * - No vault used, all data in JWT claims
 * - No incremental authorization support
 */

import { z } from 'zod';
import { randomUUID } from '@frontmcp/utils';

// ============================================
// Credential Type Enum
// ============================================

/**
 * Supported credential types for app authentication
 */
export const credentialTypeSchema = z.enum([
  'oauth', // OAuth 2.0 tokens
  'api_key', // API key (header or query param)
  'basic', // Basic auth (username:password)
  'bearer', // Bearer token (static)
  'private_key', // Private key for signing (JWT, etc.)
  'mtls', // Mutual TLS certificate
  'custom', // Custom credential type
  'ssh_key', // SSH key for authentication
  'service_account', // Cloud provider service accounts
  'oauth_pkce', // OAuth 2.0 with PKCE for public clients
]);

export type CredentialType = z.infer<typeof credentialTypeSchema>;

// ============================================
// Credential Schemas by Type
// ============================================

/**
 * OAuth credential - standard OAuth 2.0 tokens
 */
export const oauthCredentialSchema = z.object({
  type: z.literal('oauth'),
  /** Access token */
  accessToken: z.string(),
  /** Refresh token (optional) */
  refreshToken: z.string().optional(),
  /** Token type (usually 'Bearer') */
  tokenType: z.string().default('Bearer'),
  /** Token expiration timestamp (epoch ms) */
  expiresAt: z.number().optional(),
  /** Granted scopes */
  scopes: z.array(z.string()).default([]),
  /** ID token for OIDC (optional) */
  idToken: z.string().optional(),
});

/**
 * API Key credential - sent in header or query param
 */
export const apiKeyCredentialSchema = z.object({
  type: z.literal('api_key'),
  /** The API key value */
  key: z.string().min(1),
  /** Header name to use (e.g., 'X-API-Key', 'Authorization') */
  headerName: z.string().default('X-API-Key'),
  /** Prefix for the header value (e.g., 'Bearer ', 'Api-Key ') */
  headerPrefix: z.string().optional(),
  /** Alternative: send as query parameter */
  queryParam: z.string().optional(),
});

/**
 * Basic Auth credential - username and password
 */
export const basicAuthCredentialSchema = z.object({
  type: z.literal('basic'),
  /** Username */
  username: z.string().min(1),
  /** Password */
  password: z.string(),
  /** Pre-computed base64 encoded value (optional, for caching) */
  encodedValue: z.string().optional(),
});

/**
 * Bearer token credential - static bearer token
 */
export const bearerCredentialSchema = z.object({
  type: z.literal('bearer'),
  /** The bearer token value */
  token: z.string().min(1),
  /** Token expiration (optional, for static tokens that expire) */
  expiresAt: z.number().optional(),
});

/**
 * Private key credential - for JWT signing or request signing
 */
export const privateKeyCredentialSchema = z.object({
  type: z.literal('private_key'),
  /** Key format */
  format: z.enum(['pem', 'jwk', 'pkcs8', 'pkcs12']),
  /** The key data (PEM string or JWK JSON) */
  keyData: z.string(),
  /** Key ID (for JWK) */
  keyId: z.string().optional(),
  /** Algorithm to use for signing */
  algorithm: z.string().optional(),
  /** Passphrase if key is encrypted */
  passphrase: z.string().optional(),
  /** Associated certificate (for mTLS) */
  certificate: z.string().optional(),
});

/**
 * mTLS credential - client certificate for mutual TLS
 */
export const mtlsCredentialSchema = z.object({
  type: z.literal('mtls'),
  /** Client certificate (PEM format) */
  certificate: z.string(),
  /** Private key (PEM format) */
  privateKey: z.string(),
  /** Passphrase if private key is encrypted */
  passphrase: z.string().optional(),
  /** CA certificate chain (optional) */
  caCertificate: z.string().optional(),
});

/**
 * Custom credential - extensible for app-specific auth
 */
export const customCredentialSchema = z.object({
  type: z.literal('custom'),
  /** Custom type identifier */
  customType: z.string().min(1),
  /** Arbitrary credential data */
  data: z.record(z.string(), z.unknown()),
  /** Headers to include in requests */
  headers: z.record(z.string(), z.string()).optional(),
});

/**
 * SSH Key credential - for SSH-based authentication
 */
export const sshKeyCredentialSchema = z.object({
  type: z.literal('ssh_key'),
  /** Private key (PEM format) */
  privateKey: z.string().min(1),
  /** Public key (optional, can be derived from private key) */
  publicKey: z.string().optional(),
  /** Passphrase if private key is encrypted */
  passphrase: z.string().optional(),
  /** Key type */
  keyType: z.enum(['rsa', 'ed25519', 'ecdsa', 'dsa']).default('ed25519'),
  /** Key fingerprint (SHA256 hash) */
  fingerprint: z.string().optional(),
  /** Username for SSH connections */
  username: z.string().optional(),
});

/**
 * Service Account credential - for cloud provider service accounts (GCP, AWS, Azure)
 */
export const serviceAccountCredentialSchema = z.object({
  type: z.literal('service_account'),
  /** Cloud provider */
  provider: z.enum(['gcp', 'aws', 'azure', 'custom']),
  /** Raw credentials (JSON key file content, access keys, etc.) */
  credentials: z.record(z.string(), z.unknown()),
  /** Project/Account ID */
  projectId: z.string().optional(),
  /** Region for regional services */
  region: z.string().optional(),
  /** AWS: Role ARN to assume */
  assumeRoleArn: z.string().optional(),
  /** AWS: External ID for cross-account access */
  externalId: z.string().optional(),
  /** Service account email (GCP) or ARN (AWS) */
  serviceAccountId: z.string().optional(),
  /** Expiration timestamp for temporary credentials */
  expiresAt: z.number().optional(),
});

/**
 * PKCE OAuth credential - OAuth 2.0 with PKCE for public clients
 */
export const pkceOAuthCredentialSchema = z.object({
  type: z.literal('oauth_pkce'),
  /** Access token */
  accessToken: z.string(),
  /** Refresh token (optional) */
  refreshToken: z.string().optional(),
  /** Token type (usually 'Bearer') */
  tokenType: z.string().default('Bearer'),
  /** Token expiration timestamp (epoch ms) */
  expiresAt: z.number().optional(),
  /** Granted scopes */
  scopes: z.array(z.string()).default([]),
  /** ID token for OIDC (optional) */
  idToken: z.string().optional(),
  /** Authorization server issuer */
  issuer: z.string().optional(),
});

/**
 * Union of all credential types
 */
export const credentialSchema = z.discriminatedUnion('type', [
  oauthCredentialSchema,
  apiKeyCredentialSchema,
  basicAuthCredentialSchema,
  bearerCredentialSchema,
  privateKeyCredentialSchema,
  mtlsCredentialSchema,
  customCredentialSchema,
  sshKeyCredentialSchema,
  serviceAccountCredentialSchema,
  pkceOAuthCredentialSchema,
]);

export type OAuthCredential = z.infer<typeof oauthCredentialSchema>;
export type ApiKeyCredential = z.infer<typeof apiKeyCredentialSchema>;
export type BasicAuthCredential = z.infer<typeof basicAuthCredentialSchema>;
export type BearerCredential = z.infer<typeof bearerCredentialSchema>;
export type PrivateKeyCredential = z.infer<typeof privateKeyCredentialSchema>;
export type MtlsCredential = z.infer<typeof mtlsCredentialSchema>;
export type CustomCredential = z.infer<typeof customCredentialSchema>;
export type SshKeyCredential = z.infer<typeof sshKeyCredentialSchema>;
export type ServiceAccountCredential = z.infer<typeof serviceAccountCredentialSchema>;
export type PkceOAuthCredential = z.infer<typeof pkceOAuthCredentialSchema>;
export type Credential = z.infer<typeof credentialSchema>;

// ============================================
// App Credential Schema
// ============================================

/**
 * Credential stored for an app in the vault
 */
export const appCredentialSchema = z.object({
  /** App ID this credential belongs to */
  appId: z.string().min(1),
  /** Provider ID within the app (for apps with multiple auth providers) */
  providerId: z.string().min(1),
  /** The credential data */
  credential: credentialSchema,
  /** Timestamp when credential was acquired */
  acquiredAt: z.number(),
  /** Timestamp when credential was last used */
  lastUsedAt: z.number().optional(),
  /** Credential expiration (if applicable) */
  expiresAt: z.number().optional(),
  /** Whether this credential is currently valid */
  isValid: z.boolean().default(true),
  /** Error message if credential is invalid */
  invalidReason: z.string().optional(),
  /** User info associated with this credential */
  userInfo: z
    .object({
      sub: z.string().optional(),
      email: z.string().optional(),
      name: z.string().optional(),
    })
    .optional(),
  /** Metadata for tracking/debugging */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type AppCredential = z.infer<typeof appCredentialSchema>;

/**
 * Consent record stored in vault
 */
export const vaultConsentRecordSchema = z.object({
  /** Whether consent was enabled */
  enabled: z.boolean(),
  /** Selected tool IDs (user approved these) */
  selectedToolIds: z.array(z.string()),
  /** Available tool IDs at time of consent */
  availableToolIds: z.array(z.string()),
  /** Timestamp when consent was given */
  consentedAt: z.number(),
  /** Consent version for tracking changes */
  version: z.string().default('1.0'),
});

/**
 * Federated login record stored in vault
 */
export const vaultFederatedRecordSchema = z.object({
  /** Provider IDs that were selected */
  selectedProviderIds: z.array(z.string()),
  /** Provider IDs that were skipped (can be authorized later) */
  skippedProviderIds: z.array(z.string()),
  /** Primary provider ID */
  primaryProviderId: z.string().optional(),
  /** Timestamp when federated login was completed */
  completedAt: z.number(),
});

/**
 * Pending incremental authorization request
 */
export const pendingIncrementalAuthSchema = z.object({
  /** Unique ID for this request */
  id: z.string(),
  /** App ID being authorized */
  appId: z.string(),
  /** Tool ID that triggered the auth request */
  toolId: z.string().optional(),
  /** Authorization URL */
  authUrl: z.string(),
  /** Required scopes */
  requiredScopes: z.array(z.string()).optional(),
  /** Whether elicit is being used */
  elicitId: z.string().optional(),
  /** Timestamp when request was created */
  createdAt: z.number(),
  /** Expiration timestamp */
  expiresAt: z.number(),
  /** Status of the request */
  status: z.enum(['pending', 'completed', 'cancelled', 'expired']),
});

/**
 * Authorization vault entry (the full session state)
 */
export const authorizationVaultEntrySchema = z.object({
  /** Vault ID (maps to access token jti claim) */
  id: z.string(),
  /** User subject identifier */
  userSub: z.string(),
  /** User email */
  userEmail: z.string().optional(),
  /** User name */
  userName: z.string().optional(),
  /** Client ID that created this session */
  clientId: z.string(),
  /** Creation timestamp */
  createdAt: z.number(),
  /** Last access timestamp */
  lastAccessAt: z.number(),
  /** App credentials (keyed by `${appId}:${providerId}`) */
  appCredentials: z.record(z.string(), appCredentialSchema).default({}),
  /** Consent record */
  consent: vaultConsentRecordSchema.optional(),
  /** Federated login record */
  federated: vaultFederatedRecordSchema.optional(),
  /** Pending incremental authorization requests */
  pendingAuths: z.array(pendingIncrementalAuthSchema),
  /** Apps that are fully authorized */
  authorizedAppIds: z.array(z.string()),
  /** Apps that were skipped (not yet authorized) */
  skippedAppIds: z.array(z.string()),
});

// ============================================
// Types
// ============================================

export type VaultConsentRecord = z.infer<typeof vaultConsentRecordSchema>;
export type VaultFederatedRecord = z.infer<typeof vaultFederatedRecordSchema>;
export type PendingIncrementalAuth = z.infer<typeof pendingIncrementalAuthSchema>;
export type AuthorizationVaultEntry = z.infer<typeof authorizationVaultEntrySchema>;

// ============================================
// Authorization Vault Interface
// ============================================

export interface AuthorizationVault {
  /**
   * Create a new vault entry
   */
  create(params: {
    userSub: string;
    userEmail?: string;
    userName?: string;
    clientId: string;
    consent?: VaultConsentRecord;
    federated?: VaultFederatedRecord;
    authorizedAppIds?: string[];
    skippedAppIds?: string[];
  }): Promise<AuthorizationVaultEntry>;

  /**
   * Get vault entry by ID
   */
  get(id: string): Promise<AuthorizationVaultEntry | null>;

  /**
   * Update vault entry
   */
  update(id: string, updates: Partial<AuthorizationVaultEntry>): Promise<void>;

  /**
   * Delete vault entry
   */
  delete(id: string): Promise<void>;

  /**
   * Update consent in the vault
   */
  updateConsent(vaultId: string, consent: VaultConsentRecord): Promise<void>;

  /**
   * Add app to authorized list (for incremental auth)
   */
  authorizeApp(vaultId: string, appId: string): Promise<void>;

  /**
   * Create a pending incremental auth request
   */
  createPendingAuth(
    vaultId: string,
    params: {
      appId: string;
      toolId?: string;
      authUrl: string;
      requiredScopes?: string[];
      elicitId?: string;
      ttlMs?: number;
    },
  ): Promise<PendingIncrementalAuth>;

  /**
   * Get pending auth by ID
   */
  getPendingAuth(vaultId: string, pendingAuthId: string): Promise<PendingIncrementalAuth | null>;

  /**
   * Complete a pending incremental auth
   */
  completePendingAuth(vaultId: string, pendingAuthId: string): Promise<void>;

  /**
   * Cancel a pending incremental auth
   */
  cancelPendingAuth(vaultId: string, pendingAuthId: string): Promise<void>;

  /**
   * Check if app is authorized
   */
  isAppAuthorized(vaultId: string, appId: string): Promise<boolean>;

  /**
   * Get all pending auths for a vault
   */
  getPendingAuths(vaultId: string): Promise<PendingIncrementalAuth[]>;

  // ============================================
  // App Credential Methods
  // ============================================

  /**
   * Add an app credential to the vault
   * Only stores if app is authorized AND (consent disabled OR app tools in consent)
   */
  addAppCredential(vaultId: string, credential: AppCredential): Promise<void>;

  /**
   * Remove an app credential from the vault
   */
  removeAppCredential(vaultId: string, appId: string, providerId: string): Promise<void>;

  /**
   * Get all credentials for a specific app
   */
  getAppCredentials(vaultId: string, appId: string): Promise<AppCredential[]>;

  /**
   * Get a specific credential for an app and provider
   */
  getCredential(vaultId: string, appId: string, providerId: string): Promise<AppCredential | null>;

  /**
   * Get all credentials in the vault (filtered by consent if enabled)
   * @param filterByConsent If true, only returns credentials for apps with consented tools
   */
  getAllCredentials(vaultId: string, filterByConsent?: boolean): Promise<AppCredential[]>;

  /**
   * Update credential metadata (last used, validity, etc.)
   */
  updateCredential(
    vaultId: string,
    appId: string,
    providerId: string,
    updates: Partial<Pick<AppCredential, 'lastUsedAt' | 'isValid' | 'invalidReason' | 'expiresAt' | 'metadata'>>,
  ): Promise<void>;

  /**
   * Check if a credential should be stored based on consent
   * Returns true if:
   * - Consent is disabled, OR
   * - The app has at least one tool in the consent selection
   */
  shouldStoreCredential(vaultId: string, appId: string, toolIds?: string[]): Promise<boolean>;

  /**
   * Invalidate a credential (mark as invalid without removing)
   */
  invalidateCredential(vaultId: string, appId: string, providerId: string, reason: string): Promise<void>;

  /**
   * Refresh an OAuth credential (update tokens)
   */
  refreshOAuthCredential(
    vaultId: string,
    appId: string,
    providerId: string,
    tokens: { accessToken: string; refreshToken?: string; expiresAt?: number },
  ): Promise<void>;

  /**
   * Cleanup expired entries and pending auths
   */
  cleanup(): Promise<void>;
}

// ============================================
// In-Memory Implementation
// ============================================

/**
 * In-Memory Authorization Vault
 *
 * Development/testing implementation. Data is lost on restart.
 * For production, use RedisAuthorizationVault.
 */
export class InMemoryAuthorizationVault implements AuthorizationVault {
  private vaults = new Map<string, AuthorizationVaultEntry>();

  /** Default TTL for pending auth requests (10 minutes) */
  private readonly pendingAuthTtlMs = 10 * 60 * 1000;

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

    this.vaults.set(entry.id, entry);
    return entry;
  }

  async get(id: string): Promise<AuthorizationVaultEntry | null> {
    const entry = this.vaults.get(id);
    if (!entry) return null;

    // Note: lastAccessAt is updated on explicit operations, not on read
    // This prevents unnecessary writes on read operations
    return entry;
  }

  async update(id: string, updates: Partial<AuthorizationVaultEntry>): Promise<void> {
    const entry = this.vaults.get(id);
    if (!entry) return;

    Object.assign(entry, updates, { lastAccessAt: Date.now() });
  }

  async delete(id: string): Promise<void> {
    this.vaults.delete(id);
  }

  async updateConsent(vaultId: string, consent: VaultConsentRecord): Promise<void> {
    const entry = this.vaults.get(vaultId);
    if (!entry) return;

    entry.consent = consent;
    entry.lastAccessAt = Date.now();
  }

  async authorizeApp(vaultId: string, appId: string): Promise<void> {
    const entry = this.vaults.get(vaultId);
    if (!entry) return;

    // Remove from skipped, add to authorized
    entry.skippedAppIds = entry.skippedAppIds.filter((id) => id !== appId);
    if (!entry.authorizedAppIds.includes(appId)) {
      entry.authorizedAppIds.push(appId);
    }
    entry.lastAccessAt = Date.now();
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
    const entry = this.vaults.get(vaultId);
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

    return pendingAuth;
  }

  async getPendingAuth(vaultId: string, pendingAuthId: string): Promise<PendingIncrementalAuth | null> {
    const entry = this.vaults.get(vaultId);
    if (!entry) return null;

    const pendingAuth = entry.pendingAuths.find((p) => p.id === pendingAuthId);
    if (!pendingAuth) return null;

    // Check if expired
    if (Date.now() > pendingAuth.expiresAt) {
      pendingAuth.status = 'expired';
    }

    return pendingAuth;
  }

  async completePendingAuth(vaultId: string, pendingAuthId: string): Promise<void> {
    const entry = this.vaults.get(vaultId);
    if (!entry) return;

    const pendingAuth = entry.pendingAuths.find((p) => p.id === pendingAuthId);
    if (pendingAuth) {
      pendingAuth.status = 'completed';

      // Auto-authorize the app
      await this.authorizeApp(vaultId, pendingAuth.appId);
    }
  }

  async cancelPendingAuth(vaultId: string, pendingAuthId: string): Promise<void> {
    const entry = this.vaults.get(vaultId);
    if (!entry) return;

    const pendingAuth = entry.pendingAuths.find((p) => p.id === pendingAuthId);
    if (pendingAuth) {
      pendingAuth.status = 'cancelled';
    }
  }

  async isAppAuthorized(vaultId: string, appId: string): Promise<boolean> {
    const entry = this.vaults.get(vaultId);
    if (!entry) return false;

    return entry.authorizedAppIds.includes(appId);
  }

  async getPendingAuths(vaultId: string): Promise<PendingIncrementalAuth[]> {
    const entry = this.vaults.get(vaultId);
    if (!entry) return [];

    const now = Date.now();

    // Update expired status and filter
    return entry.pendingAuths.filter((p) => {
      if (now > p.expiresAt && p.status === 'pending') {
        p.status = 'expired';
      }
      return p.status === 'pending';
    });
  }

  async cleanup(): Promise<void> {
    const now = Date.now();

    for (const [id, entry] of this.vaults) {
      // Clean up expired pending auths
      entry.pendingAuths = entry.pendingAuths.filter((p) => {
        if (now > p.expiresAt && p.status === 'pending') {
          p.status = 'expired';
        }
        // Keep for audit trail, or remove completely if desired
        return p.status === 'pending';
      });
    }
  }

  // ============================================
  // App Credential Methods
  // ============================================

  /** Create a credential key from appId and providerId */
  private credentialKey(appId: string, providerId: string): string {
    return `${appId}:${providerId}`;
  }

  async addAppCredential(vaultId: string, credential: AppCredential): Promise<void> {
    const entry = this.vaults.get(vaultId);
    if (!entry) return;

    // Check if we should store based on consent
    const shouldStore = await this.shouldStoreCredential(vaultId, credential.appId);
    if (!shouldStore) {
      return;
    }

    const key = this.credentialKey(credential.appId, credential.providerId);
    entry.appCredentials[key] = credential;
    entry.lastAccessAt = Date.now();
  }

  async removeAppCredential(vaultId: string, appId: string, providerId: string): Promise<void> {
    const entry = this.vaults.get(vaultId);
    if (!entry) return;

    const key = this.credentialKey(appId, providerId);
    delete entry.appCredentials[key];
    entry.lastAccessAt = Date.now();
  }

  async getAppCredentials(vaultId: string, appId: string): Promise<AppCredential[]> {
    const entry = this.vaults.get(vaultId);
    if (!entry) return [];

    const prefix = `${appId}:`;
    return Object.entries(entry.appCredentials)
      .filter(([key]) => key.startsWith(prefix))
      .map(([, cred]) => cred);
  }

  async getCredential(vaultId: string, appId: string, providerId: string): Promise<AppCredential | null> {
    const entry = this.vaults.get(vaultId);
    if (!entry) return null;

    const key = this.credentialKey(appId, providerId);
    return entry.appCredentials[key] ?? null;
  }

  async getAllCredentials(vaultId: string, filterByConsent = false): Promise<AppCredential[]> {
    const entry = this.vaults.get(vaultId);
    if (!entry) return [];

    const allCredentials = Object.values(entry.appCredentials);

    if (!filterByConsent || !entry.consent?.enabled) {
      return allCredentials;
    }

    // Filter by consent - only return credentials for apps that have tools in consent selection
    const consentedToolIds = new Set(entry.consent.selectedToolIds);
    return allCredentials.filter((cred) => {
      // Check if any tool for this app is in consent
      // Tool IDs are typically formatted as `appId:toolName` or similar
      return Array.from(consentedToolIds).some((toolId) => toolId.startsWith(`${cred.appId}:`));
    });
  }

  async updateCredential(
    vaultId: string,
    appId: string,
    providerId: string,
    updates: Partial<Pick<AppCredential, 'lastUsedAt' | 'isValid' | 'invalidReason' | 'expiresAt' | 'metadata'>>,
  ): Promise<void> {
    const entry = this.vaults.get(vaultId);
    if (!entry) return;

    const key = this.credentialKey(appId, providerId);
    const credential = entry.appCredentials[key];
    if (!credential) return;

    Object.assign(credential, updates);
    entry.lastAccessAt = Date.now();
  }

  async shouldStoreCredential(vaultId: string, appId: string, toolIds?: string[]): Promise<boolean> {
    const entry = this.vaults.get(vaultId);
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
    const entry = this.vaults.get(vaultId);
    if (!entry) return;

    const key = this.credentialKey(appId, providerId);
    const credential = entry.appCredentials[key];
    if (!credential || (credential.credential.type !== 'oauth' && credential.credential.type !== 'oauth_pkce')) return;

    // Update OAuth/PKCE tokens
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
  }
}

// ============================================
// Redis Implementation
// ============================================

/**
 * Redis Authorization Vault
 *
 * Production implementation using Redis for distributed storage.
 */
export class RedisAuthorizationVault implements AuthorizationVault {
  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly redis: any,
    private readonly namespace = 'vault:',
  ) {}

  private key(id: string): string {
    return `${this.namespace}${id}`;
  }

  /** Create a credential key from appId and providerId */
  private credentialKey(appId: string, providerId: string): string {
    return `${appId}:${providerId}`;
  }

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

    await this.redis.set(this.key(entry.id), JSON.stringify(entry));
    return entry;
  }

  async get(id: string): Promise<AuthorizationVaultEntry | null> {
    const data = await this.redis.get(this.key(id));
    if (!data) return null;

    const entry = JSON.parse(data) as AuthorizationVaultEntry;
    return entry;
  }

  async update(id: string, updates: Partial<AuthorizationVaultEntry>): Promise<void> {
    const entry = await this.get(id);
    if (!entry) return;

    Object.assign(entry, updates, { lastAccessAt: Date.now() });
    await this.redis.set(this.key(id), JSON.stringify(entry));
  }

  async delete(id: string): Promise<void> {
    await this.redis.del(this.key(id));
  }

  async updateConsent(vaultId: string, consent: VaultConsentRecord): Promise<void> {
    const entry = await this.get(vaultId);
    if (!entry) return;

    entry.consent = consent;
    await this.redis.set(this.key(vaultId), JSON.stringify(entry));
  }

  async authorizeApp(vaultId: string, appId: string): Promise<void> {
    const entry = await this.get(vaultId);
    if (!entry) return;

    entry.skippedAppIds = entry.skippedAppIds.filter((id) => id !== appId);
    if (!entry.authorizedAppIds.includes(appId)) {
      entry.authorizedAppIds.push(appId);
    }
    await this.redis.set(this.key(vaultId), JSON.stringify(entry));
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
      expiresAt: now + (params.ttlMs ?? 10 * 60 * 1000),
      status: 'pending',
    };

    entry.pendingAuths.push(pendingAuth);
    await this.redis.set(this.key(vaultId), JSON.stringify(entry));

    return pendingAuth;
  }

  async getPendingAuth(vaultId: string, pendingAuthId: string): Promise<PendingIncrementalAuth | null> {
    const entry = await this.get(vaultId);
    if (!entry) return null;

    const pendingAuth = entry.pendingAuths.find((p) => p.id === pendingAuthId);
    if (!pendingAuth) return null;

    if (Date.now() > pendingAuth.expiresAt && pendingAuth.status === 'pending') {
      pendingAuth.status = 'expired';
      await this.redis.set(this.key(vaultId), JSON.stringify(entry));
    }

    return pendingAuth;
  }

  async completePendingAuth(vaultId: string, pendingAuthId: string): Promise<void> {
    const entry = await this.get(vaultId);
    if (!entry) return;

    const pendingAuth = entry.pendingAuths.find((p) => p.id === pendingAuthId);
    if (pendingAuth) {
      pendingAuth.status = 'completed';

      // Persist the status change before authorizeApp (which reloads the entry)
      await this.redis.set(this.key(vaultId), JSON.stringify(entry));

      // Auto-authorize the app
      await this.authorizeApp(vaultId, pendingAuth.appId);
    }
  }

  async cancelPendingAuth(vaultId: string, pendingAuthId: string): Promise<void> {
    const entry = await this.get(vaultId);
    if (!entry) return;

    const pendingAuth = entry.pendingAuths.find((p) => p.id === pendingAuthId);
    if (pendingAuth) {
      pendingAuth.status = 'cancelled';
      await this.redis.set(this.key(vaultId), JSON.stringify(entry));
    }
  }

  async isAppAuthorized(vaultId: string, appId: string): Promise<boolean> {
    const entry = await this.get(vaultId);
    if (!entry) return false;

    return entry.authorizedAppIds.includes(appId);
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
      await this.redis.set(this.key(vaultId), JSON.stringify(entry));
    }

    return pending;
  }

  async cleanup(): Promise<void> {
    // Redis cleanup would use SCAN to find and clean entries
    // This is a placeholder
  }

  // ============================================
  // App Credential Methods
  // ============================================

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
    await this.redis.set(this.key(vaultId), JSON.stringify(entry));
  }

  async removeAppCredential(vaultId: string, appId: string, providerId: string): Promise<void> {
    const entry = await this.get(vaultId);
    if (!entry) return;

    const key = this.credentialKey(appId, providerId);
    delete entry.appCredentials[key];
    await this.redis.set(this.key(vaultId), JSON.stringify(entry));
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
    await this.redis.set(this.key(vaultId), JSON.stringify(entry));
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

    // Update OAuth/PKCE tokens
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
    await this.redis.set(this.key(vaultId), JSON.stringify(entry));
  }
}
