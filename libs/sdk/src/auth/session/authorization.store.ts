// auth/session/authorization.store.ts
/**
 * Authorization Store for OAuth flows
 *
 * Stores authorization codes, PKCE challenges, and pending authorizations.
 * Supports both in-memory (dev/test) and Redis (production) backends.
 */

import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';

/**
 * PKCE challenge data
 */
export interface PkceChallenge {
  /** S256 hashed code_challenge */
  challenge: string;
  /** Always 'S256' per OAuth 2.1 */
  method: 'S256';
}

/**
 * Authorization code record stored during the OAuth flow
 */
export interface AuthorizationCodeRecord {
  /** The authorization code (opaque string) */
  code: string;
  /** Client ID that requested authorization */
  clientId: string;
  /** Redirect URI used in the authorization request */
  redirectUri: string;
  /** Requested scopes */
  scopes: string[];
  /** PKCE challenge for verification */
  pkce: PkceChallenge;
  /** User identifier (sub claim) */
  userSub: string;
  /** User email if available */
  userEmail?: string;
  /** User name if available */
  userName?: string;
  /** Original state parameter */
  state?: string;
  /** Creation timestamp (epoch ms) */
  createdAt: number;
  /** Expiration timestamp (epoch ms) - codes are short-lived (60s default) */
  expiresAt: number;
  /** Whether this code has been used (single-use) */
  used: boolean;
  /** Resource/audience the token will be issued for */
  resource?: string;

  // Consent and Federated Login Data
  /** Selected tool IDs from consent flow */
  selectedToolIds?: string[];
  /** Selected provider IDs from federated login */
  selectedProviderIds?: string[];
  /** Skipped provider IDs from federated login (for progressive auth) */
  skippedProviderIds?: string[];
  /** Whether consent was enabled for this authorization */
  consentEnabled?: boolean;
  /** Whether federated login was used */
  federatedLoginUsed?: boolean;
}

/**
 * Consent state for tool selection
 */
export interface ConsentStateRecord {
  /** Whether consent flow is enabled */
  enabled: boolean;
  /** Available tool IDs for consent */
  availableToolIds: string[];
  /** Selected tool IDs (after user selection) */
  selectedToolIds?: string[];
  /** Whether consent has been completed */
  consentCompleted: boolean;
  /** Timestamp when consent was completed */
  consentCompletedAt?: number;
}

/**
 * Federated login state for multi-provider auth
 */
export interface FederatedLoginStateRecord {
  /** Available provider IDs */
  providerIds: string[];
  /** Selected provider IDs */
  selectedProviderIds?: string[];
  /** Skipped provider IDs */
  skippedProviderIds?: string[];
  /** Provider-specific user data (after auth) */
  providerUserData?: Record<string, { email?: string; name?: string; sub?: string }>;
}

/**
 * Pending authorization request (before user authenticates)
 */
export interface PendingAuthorizationRecord {
  /** Unique ID for this pending authorization */
  id: string;
  /** Client ID requesting authorization */
  clientId: string;
  /** Redirect URI for callback */
  redirectUri: string;
  /** Requested scopes */
  scopes: string[];
  /** PKCE challenge */
  pkce: PkceChallenge;
  /** Original state parameter from client */
  state?: string;
  /** Resource/audience */
  resource?: string;
  /** Creation timestamp */
  createdAt: number;
  /** Expiration timestamp (pending requests expire after 10 minutes) */
  expiresAt: number;

  // Progressive/Incremental Authorization Fields
  /** Whether this is an incremental authorization request */
  isIncremental?: boolean;
  /** Target app ID for incremental authorization */
  targetAppId?: string;
  /** Target tool ID that triggered the incremental auth */
  targetToolId?: string;
  /** Existing session ID for incremental auth (to expand the token vault) */
  existingSessionId?: string;
  /** Existing authorization ID to expand */
  existingAuthorizationId?: string;

  // Federated Login State
  /** Federated login state for multi-provider auth */
  federatedLogin?: FederatedLoginStateRecord;

  // Consent State
  /** Consent state for tool selection */
  consent?: ConsentStateRecord;
}

/**
 * Refresh token record
 */
export interface RefreshTokenRecord {
  /** The refresh token (opaque string) */
  token: string;
  /** Client ID */
  clientId: string;
  /** User identifier */
  userSub: string;
  /** Granted scopes */
  scopes: string[];
  /** Resource/audience */
  resource?: string;
  /** Creation timestamp */
  createdAt: number;
  /** Expiration timestamp */
  expiresAt: number;
  /** Whether this token has been revoked */
  revoked: boolean;
  /** Previous token if rotated */
  previousToken?: string;
}

/**
 * Zod schemas for validation
 */
export const pkceChallengeSchema = z.object({
  challenge: z.string().min(43).max(128),
  method: z.literal('S256'),
});

export const authorizationCodeRecordSchema = z.object({
  code: z.string().min(1),
  clientId: z.string().min(1),
  redirectUri: z.string().url(),
  scopes: z.array(z.string()),
  pkce: pkceChallengeSchema,
  userSub: z.string().min(1),
  userEmail: z.string().email().optional(),
  userName: z.string().optional(),
  state: z.string().optional(),
  createdAt: z.number(),
  expiresAt: z.number(),
  used: z.boolean(),
  resource: z.string().url().optional(),
});

/**
 * Authorization Store Interface
 */
export interface AuthorizationStore {
  // Authorization code operations
  storeAuthorizationCode(record: AuthorizationCodeRecord): Promise<void>;
  getAuthorizationCode(code: string): Promise<AuthorizationCodeRecord | null>;
  markCodeUsed(code: string): Promise<void>;
  deleteAuthorizationCode(code: string): Promise<void>;

  // Pending authorization operations
  storePendingAuthorization(record: PendingAuthorizationRecord): Promise<void>;
  getPendingAuthorization(id: string): Promise<PendingAuthorizationRecord | null>;
  deletePendingAuthorization(id: string): Promise<void>;

  // Refresh token operations
  storeRefreshToken(record: RefreshTokenRecord): Promise<void>;
  getRefreshToken(token: string): Promise<RefreshTokenRecord | null>;
  revokeRefreshToken(token: string): Promise<void>;
  rotateRefreshToken(oldToken: string, newRecord: RefreshTokenRecord): Promise<void>;

  // Utility
  generateCode(): string;
  generateRefreshToken(): string;
  cleanup(): Promise<void>;
}

/**
 * PKCE utilities
 */
export function verifyPkce(codeVerifier: string, challenge: PkceChallenge): boolean {
  if (challenge.method !== 'S256') {
    return false;
  }

  // S256: BASE64URL(SHA256(code_verifier)) === code_challenge
  const hash = createHash('sha256').update(codeVerifier).digest('base64url');
  return hash === challenge.challenge;
}

export function generatePkceChallenge(codeVerifier: string): PkceChallenge {
  const challenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { challenge, method: 'S256' };
}

/**
 * In-Memory Authorization Store
 *
 * Development/testing implementation. Data is lost on restart.
 * For production, use RedisAuthorizationStore.
 */
export class InMemoryAuthorizationStore implements AuthorizationStore {
  private codes = new Map<string, AuthorizationCodeRecord>();
  private pending = new Map<string, PendingAuthorizationRecord>();
  private refreshTokens = new Map<string, RefreshTokenRecord>();

  /** Default TTL for authorization codes (60 seconds) */
  private readonly codeTtlMs = 60 * 1000;
  /** Default TTL for pending authorizations (10 minutes) */
  private readonly pendingTtlMs = 10 * 60 * 1000;
  /** Default TTL for refresh tokens (30 days) */
  private readonly refreshTtlMs = 30 * 24 * 60 * 60 * 1000;

  generateCode(): string {
    // Generate a cryptographically secure authorization code
    return randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
  }

  generateRefreshToken(): string {
    return randomUUID() + '-' + randomUUID();
  }

  async storeAuthorizationCode(record: AuthorizationCodeRecord): Promise<void> {
    this.codes.set(record.code, record);
  }

  async getAuthorizationCode(code: string): Promise<AuthorizationCodeRecord | null> {
    const record = this.codes.get(code);
    if (!record) return null;

    // Check expiration
    if (Date.now() > record.expiresAt) {
      this.codes.delete(code);
      return null;
    }

    return record;
  }

  async markCodeUsed(code: string): Promise<void> {
    const record = this.codes.get(code);
    if (record) {
      record.used = true;
    }
  }

  async deleteAuthorizationCode(code: string): Promise<void> {
    this.codes.delete(code);
  }

  async storePendingAuthorization(record: PendingAuthorizationRecord): Promise<void> {
    this.pending.set(record.id, record);
  }

  async getPendingAuthorization(id: string): Promise<PendingAuthorizationRecord | null> {
    const record = this.pending.get(id);
    if (!record) return null;

    // Check expiration
    if (Date.now() > record.expiresAt) {
      this.pending.delete(id);
      return null;
    }

    return record;
  }

  async deletePendingAuthorization(id: string): Promise<void> {
    this.pending.delete(id);
  }

  async storeRefreshToken(record: RefreshTokenRecord): Promise<void> {
    this.refreshTokens.set(record.token, record);
  }

  async getRefreshToken(token: string): Promise<RefreshTokenRecord | null> {
    const record = this.refreshTokens.get(token);
    if (!record) return null;

    // Check expiration and revocation
    if (Date.now() > record.expiresAt || record.revoked) {
      return null;
    }

    return record;
  }

  async revokeRefreshToken(token: string): Promise<void> {
    const record = this.refreshTokens.get(token);
    if (record) {
      record.revoked = true;
    }
  }

  async rotateRefreshToken(oldToken: string, newRecord: RefreshTokenRecord): Promise<void> {
    // Revoke old token
    await this.revokeRefreshToken(oldToken);

    // Store new token with reference to old
    newRecord.previousToken = oldToken;
    await this.storeRefreshToken(newRecord);
  }

  async cleanup(): Promise<void> {
    const now = Date.now();

    // Clean expired codes
    for (const [code, record] of this.codes) {
      if (now > record.expiresAt) {
        this.codes.delete(code);
      }
    }

    // Clean expired pending authorizations
    for (const [id, record] of this.pending) {
      if (now > record.expiresAt) {
        this.pending.delete(id);
      }
    }

    // Clean expired/revoked refresh tokens
    for (const [token, record] of this.refreshTokens) {
      if (now > record.expiresAt || record.revoked) {
        this.refreshTokens.delete(token);
      }
    }
  }

  /**
   * Create an authorization code record with defaults
   */
  createCodeRecord(params: {
    clientId: string;
    redirectUri: string;
    scopes: string[];
    pkce: PkceChallenge;
    userSub: string;
    userEmail?: string;
    userName?: string;
    state?: string;
    resource?: string;
    // Consent and Federated Login Data
    selectedToolIds?: string[];
    selectedProviderIds?: string[];
    skippedProviderIds?: string[];
    consentEnabled?: boolean;
    federatedLoginUsed?: boolean;
  }): AuthorizationCodeRecord {
    const now = Date.now();
    return {
      code: this.generateCode(),
      clientId: params.clientId,
      redirectUri: params.redirectUri,
      scopes: params.scopes,
      pkce: params.pkce,
      userSub: params.userSub,
      userEmail: params.userEmail,
      userName: params.userName,
      state: params.state,
      resource: params.resource,
      createdAt: now,
      expiresAt: now + this.codeTtlMs,
      used: false,
      // Consent and Federated Login Data
      selectedToolIds: params.selectedToolIds,
      selectedProviderIds: params.selectedProviderIds,
      skippedProviderIds: params.skippedProviderIds,
      consentEnabled: params.consentEnabled,
      federatedLoginUsed: params.federatedLoginUsed,
    };
  }

  /**
   * Create a pending authorization record with defaults
   */
  createPendingRecord(params: {
    clientId: string;
    redirectUri: string;
    scopes: string[];
    pkce: PkceChallenge;
    state?: string;
    resource?: string;
    // Progressive/Incremental Authorization Fields
    isIncremental?: boolean;
    targetAppId?: string;
    targetToolId?: string;
    existingSessionId?: string;
    existingAuthorizationId?: string;
    // Federated Login State
    federatedLogin?: FederatedLoginStateRecord;
    // Consent State
    consent?: ConsentStateRecord;
  }): PendingAuthorizationRecord {
    const now = Date.now();
    return {
      id: randomUUID(),
      clientId: params.clientId,
      redirectUri: params.redirectUri,
      scopes: params.scopes,
      pkce: params.pkce,
      state: params.state,
      resource: params.resource,
      createdAt: now,
      expiresAt: now + this.pendingTtlMs,
      // Progressive/Incremental Authorization Fields
      isIncremental: params.isIncremental,
      targetAppId: params.targetAppId,
      targetToolId: params.targetToolId,
      existingSessionId: params.existingSessionId,
      existingAuthorizationId: params.existingAuthorizationId,
      // Federated Login State
      federatedLogin: params.federatedLogin,
      // Consent State
      consent: params.consent,
    };
  }

  /**
   * Create a refresh token record with defaults
   */
  createRefreshTokenRecord(params: {
    clientId: string;
    userSub: string;
    scopes: string[];
    resource?: string;
  }): RefreshTokenRecord {
    const now = Date.now();
    return {
      token: this.generateRefreshToken(),
      clientId: params.clientId,
      userSub: params.userSub,
      scopes: params.scopes,
      resource: params.resource,
      createdAt: now,
      expiresAt: now + this.refreshTtlMs,
      revoked: false,
    };
  }
}

/**
 * Redis Authorization Store (placeholder)
 *
 * Production implementation using Redis for distributed storage.
 * TODO: Implement after in-memory store is validated.
 */
export class RedisAuthorizationStore implements AuthorizationStore {
  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly redis: any,
    private readonly namespace = 'oauth:',
  ) {}

  private key(type: 'code' | 'pending' | 'refresh', id: string): string {
    return `${this.namespace}${type}:${id}`;
  }

  generateCode(): string {
    return randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
  }

  generateRefreshToken(): string {
    return randomUUID() + '-' + randomUUID();
  }

  async storeAuthorizationCode(record: AuthorizationCodeRecord): Promise<void> {
    const ttl = Math.max(Math.ceil((record.expiresAt - Date.now()) / 1000), 1);
    await this.redis.set(this.key('code', record.code), JSON.stringify(record), 'EX', Math.max(ttl, 1));
  }

  async getAuthorizationCode(code: string): Promise<AuthorizationCodeRecord | null> {
    const data = await this.redis.get(this.key('code', code));
    if (!data) return null;
    return JSON.parse(data) as AuthorizationCodeRecord;
  }

  async markCodeUsed(code: string): Promise<void> {
    const record = await this.getAuthorizationCode(code);
    if (record) {
      record.used = true;
      const ttl = Math.ceil((record.expiresAt - Date.now()) / 1000);
      await this.redis.set(this.key('code', code), JSON.stringify(record), 'EX', Math.max(ttl, 1));
    }
  }

  async deleteAuthorizationCode(code: string): Promise<void> {
    await this.redis.del(this.key('code', code));
  }

  async storePendingAuthorization(record: PendingAuthorizationRecord): Promise<void> {
    const ttl = Math.max(Math.ceil((record.expiresAt - Date.now()) / 1000), 1);
    await this.redis.set(this.key('pending', record.id), JSON.stringify(record), 'EX', ttl);
  }

  async getPendingAuthorization(id: string): Promise<PendingAuthorizationRecord | null> {
    const data = await this.redis.get(this.key('pending', id));
    if (!data) return null;
    return JSON.parse(data) as PendingAuthorizationRecord;
  }

  async deletePendingAuthorization(id: string): Promise<void> {
    await this.redis.del(this.key('pending', id));
  }

  async storeRefreshToken(record: RefreshTokenRecord): Promise<void> {
    const ttl = Math.ceil((record.expiresAt - Date.now()) / 1000);
    await this.redis.set(this.key('refresh', record.token), JSON.stringify(record), 'EX', ttl);
  }

  async getRefreshToken(token: string): Promise<RefreshTokenRecord | null> {
    const data = await this.redis.get(this.key('refresh', token));
    if (!data) return null;
    const record = JSON.parse(data) as RefreshTokenRecord;
    if (record.revoked) return null;
    return record;
  }

  async revokeRefreshToken(token: string): Promise<void> {
    const record = await this.getRefreshToken(token);
    if (record) {
      record.revoked = true;
      const ttl = Math.ceil((record.expiresAt - Date.now()) / 1000);
      await this.redis.set(this.key('refresh', token), JSON.stringify(record), 'EX', Math.max(ttl, 1));
    }
  }

  async rotateRefreshToken(oldToken: string, newRecord: RefreshTokenRecord): Promise<void> {
    await this.revokeRefreshToken(oldToken);
    newRecord.previousToken = oldToken;
    await this.storeRefreshToken(newRecord);
  }

  async cleanup(): Promise<void> {
    // Redis handles cleanup via TTL, nothing to do here
  }
}
