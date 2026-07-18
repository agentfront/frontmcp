// auth/session/authorization.store.ts
/**
 * Authorization Store for OAuth flows
 *
 * Stores authorization codes, PKCE challenges, and pending authorizations.
 * Supports both in-memory (dev/test) and Redis (production) backends.
 */

import { z } from '@frontmcp/lazy-zod';
import { randomUUID, sha256Base64url } from '@frontmcp/utils';

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
  /**
   * The refresh token minted from this code. Recorded when the code is consumed
   * so that a detected REPLAY (re-presenting an already-used code — a strong
   * signal the code leaked) can revoke the token family issued from it, per
   * OAuth 2.1 §4.1.2 breach handling.
   */
  issuedRefreshToken?: string;
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
  /** Pending auth ID for token migration (federated login) */
  pendingAuthId?: string;
  /**
   * Progressive/Incremental authorization: the app IDs this code grants access
   * to. Embedded as the `authorized_apps` claim in the minted token (which
   * turns on app-level gating). Only set when `incrementalAuth` is enabled for
   * the scope; absent for non-incremental setups (preserving allow-all).
   */
  authorizedAppIds?: string[];
  /**
   * Custom claims returned by a local `authenticate` verifier (Checkpoint 3a).
   * Embedded (namespaced) in the minted access token. Reserved claims
   * (sub/iss/exp/…) are stripped when signed.
   */
  customClaims?: Record<string, unknown>;
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
  /**
   * App IDs the client already holds a grant for (its prior `authorized_apps`
   * claim), carried forward on an incremental authorize so the minted token's
   * grant is the UNION of these plus `targetAppId`.
   */
  priorAuthorizedAppIds?: string[];

  // Federated Login State
  /** Federated login state for multi-provider auth */
  federatedLogin?: FederatedLoginStateRecord;

  // Consent State
  /** Consent state for tool selection */
  consent?: ConsentStateRecord;

  /**
   * Anti-CSRF token minted at SSR time for a custom `@AuthUi` page (#469).
   * Echoed back by the client in the `csrf` field and verified on the callback /
   * extra submit. Absent for the built-in pages (no CSRF requirement there).
   */
  authUiCsrf?: string;
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

  // --- Grant metadata carried across refresh so the re-minted access token
  // keeps its consent / progressive-authorization claims (otherwise refreshing
  // silently strips `consent` / `authorized_apps` and the tool gate fails open).
  /** User email, re-embedded in refreshed access tokens. */
  userEmail?: string;
  /** User display name, re-embedded in refreshed access tokens. */
  userName?: string;
  /** Whether tool-level consent was enabled for this grant. */
  consentEnabled?: boolean;
  /** Consented tool ids (when `consentEnabled`). */
  selectedToolIds?: string[];
  /** Granted app ids for incremental/progressive authorization. */
  authorizedAppIds?: string[];
  /** Custom claims embedded at authorize time (e.g. from a local authenticate() verifier). */
  customClaims?: Record<string, unknown>;
  /** Whether federated login was used for this grant. */
  federatedLoginUsed?: boolean;
  /** Selected federated provider ids. */
  selectedProviderIds?: string[];
  /** Skipped federated provider ids. */
  skippedProviderIds?: string[];
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
  // Consent and federated login fields
  selectedToolIds: z.array(z.string()).optional(),
  selectedProviderIds: z.array(z.string()).optional(),
  skippedProviderIds: z.array(z.string()).optional(),
  consentEnabled: z.boolean().optional(),
  federatedLoginUsed: z.boolean().optional(),
  pendingAuthId: z.string().optional(),
  // Progressive/Incremental authorization: granted app-id set.
  authorizedAppIds: z.array(z.string()).optional(),
  // Custom claims from a local authenticate() verifier (Checkpoint 3a).
  customClaims: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Parameters for building an authorization code record.
 */
export interface CreateCodeRecordParams {
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
  // Token migration ID (for federated auth)
  pendingAuthId?: string;
  // Progressive/Incremental authorization: granted app-id set.
  authorizedAppIds?: string[];
  // Custom claims from a local authenticate() verifier (Checkpoint 3a).
  customClaims?: Record<string, unknown>;
}

/**
 * Parameters for building a pending authorization record.
 */
export interface CreatePendingRecordParams {
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
  // Prior authorized app IDs to carry forward on an incremental authorize.
  priorAuthorizedAppIds?: string[];
  // Federated Login State
  federatedLogin?: FederatedLoginStateRecord;
  // Consent State
  consent?: ConsentStateRecord;
  // Anti-CSRF token for a custom `@AuthUi` page (#469). Usually minted lazily at
  // SSR time and assigned onto an existing record, but accepted here so a caller
  // can seed it at creation time without losing it.
  authUiCsrf?: string;
}

/**
 * Parameters for building a refresh token record.
 */
export interface CreateRefreshTokenRecordParams {
  clientId: string;
  userSub: string;
  scopes: string[];
  resource?: string;
  // Grant metadata preserved across refresh (see RefreshTokenRecord).
  userEmail?: string;
  userName?: string;
  consentEnabled?: boolean;
  selectedToolIds?: string[];
  authorizedAppIds?: string[];
  customClaims?: Record<string, unknown>;
  federatedLoginUsed?: boolean;
  selectedProviderIds?: string[];
  skippedProviderIds?: string[];
}

/** Default TTL for authorization codes (60 seconds). */
export const AUTH_CODE_TTL_MS = 60 * 1000;
/** Default TTL for pending authorizations (10 minutes). */
export const PENDING_AUTH_TTL_MS = 10 * 60 * 1000;
/** Default TTL for refresh tokens (30 days). */
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Generate a cryptographically secure authorization code.
 */
export function generateAuthorizationCode(): string {
  return randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
}

/**
 * Generate a refresh token string.
 */
export function generateRefreshTokenValue(): string {
  return randomUUID() + '-' + randomUUID();
}

/**
 * Build an authorization code record with defaults. Pure (no storage I/O), so
 * it is shared by every {@link AuthorizationStore} implementation.
 */
export function buildCodeRecord(params: CreateCodeRecordParams): AuthorizationCodeRecord {
  const now = Date.now();
  return {
    code: generateAuthorizationCode(),
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
    expiresAt: now + AUTH_CODE_TTL_MS,
    used: false,
    selectedToolIds: params.selectedToolIds,
    selectedProviderIds: params.selectedProviderIds,
    skippedProviderIds: params.skippedProviderIds,
    consentEnabled: params.consentEnabled,
    federatedLoginUsed: params.federatedLoginUsed,
    pendingAuthId: params.pendingAuthId,
    authorizedAppIds: params.authorizedAppIds,
    customClaims: params.customClaims,
  };
}

/**
 * Build a pending authorization record with defaults.
 */
export function buildPendingRecord(params: CreatePendingRecordParams): PendingAuthorizationRecord {
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
    expiresAt: now + PENDING_AUTH_TTL_MS,
    isIncremental: params.isIncremental,
    targetAppId: params.targetAppId,
    targetToolId: params.targetToolId,
    existingSessionId: params.existingSessionId,
    existingAuthorizationId: params.existingAuthorizationId,
    priorAuthorizedAppIds: params.priorAuthorizedAppIds,
    federatedLogin: params.federatedLogin,
    consent: params.consent,
    authUiCsrf: params.authUiCsrf,
  };
}

/**
 * Build a refresh token record with defaults.
 */
export function buildRefreshTokenRecord(params: CreateRefreshTokenRecordParams): RefreshTokenRecord {
  const now = Date.now();
  return {
    token: generateRefreshTokenValue(),
    clientId: params.clientId,
    userSub: params.userSub,
    scopes: params.scopes,
    resource: params.resource,
    createdAt: now,
    expiresAt: now + REFRESH_TOKEN_TTL_MS,
    revoked: false,
    // Preserve grant metadata so a refreshed access token keeps its
    // consent/authorized_apps/custom claims.
    userEmail: params.userEmail,
    userName: params.userName,
    consentEnabled: params.consentEnabled,
    selectedToolIds: params.selectedToolIds,
    authorizedAppIds: params.authorizedAppIds,
    customClaims: params.customClaims,
    federatedLoginUsed: params.federatedLoginUsed,
    selectedProviderIds: params.selectedProviderIds,
    skippedProviderIds: params.skippedProviderIds,
  };
}

/**
 * Authorization Store Interface
 */
export interface AuthorizationStore {
  // Authorization code operations
  storeAuthorizationCode(record: AuthorizationCodeRecord): Promise<void>;
  getAuthorizationCode(code: string): Promise<AuthorizationCodeRecord | null>;
  markCodeUsed(code: string, issuedRefreshToken?: string): Promise<void>;
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

  // Record builders (pure; backend-agnostic) — part of the interface so callers
  // never need to downcast to a concrete store to mint records.
  generateCode(): string;
  generateRefreshToken(): string;
  createCodeRecord(params: CreateCodeRecordParams): AuthorizationCodeRecord;
  createPendingRecord(params: CreatePendingRecordParams): PendingAuthorizationRecord;
  createRefreshTokenRecord(params: CreateRefreshTokenRecordParams): RefreshTokenRecord;

  // Utility
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
  const hash = sha256Base64url(codeVerifier);
  return hash === challenge.challenge;
}

export function generatePkceChallenge(codeVerifier: string): PkceChallenge {
  const challenge = sha256Base64url(codeVerifier);
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

  generateCode(): string {
    return generateAuthorizationCode();
  }

  generateRefreshToken(): string {
    return generateRefreshTokenValue();
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

  async markCodeUsed(code: string, issuedRefreshToken?: string): Promise<void> {
    const record = this.codes.get(code);
    if (record) {
      record.used = true;
      if (issuedRefreshToken) record.issuedRefreshToken = issuedRefreshToken;
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
   * Create an authorization code record with defaults.
   */
  createCodeRecord(params: CreateCodeRecordParams): AuthorizationCodeRecord {
    return buildCodeRecord(params);
  }

  /**
   * Create a pending authorization record with defaults.
   */
  createPendingRecord(params: CreatePendingRecordParams): PendingAuthorizationRecord {
    return buildPendingRecord(params);
  }

  /**
   * Create a refresh token record with defaults.
   */
  createRefreshTokenRecord(params: CreateRefreshTokenRecordParams): RefreshTokenRecord {
    return buildRefreshTokenRecord(params);
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
    private readonly redis: any,
    private readonly namespace = 'oauth:',
  ) {}

  private key(type: 'code' | 'pending' | 'refresh', id: string): string {
    return `${this.namespace}${type}:${id}`;
  }

  generateCode(): string {
    return generateAuthorizationCode();
  }

  generateRefreshToken(): string {
    return generateRefreshTokenValue();
  }

  createCodeRecord(params: CreateCodeRecordParams): AuthorizationCodeRecord {
    return buildCodeRecord(params);
  }

  createPendingRecord(params: CreatePendingRecordParams): PendingAuthorizationRecord {
    return buildPendingRecord(params);
  }

  createRefreshTokenRecord(params: CreateRefreshTokenRecordParams): RefreshTokenRecord {
    return buildRefreshTokenRecord(params);
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

  async markCodeUsed(code: string, issuedRefreshToken?: string): Promise<void> {
    const record = await this.getAuthorizationCode(code);
    if (record) {
      record.used = true;
      if (issuedRefreshToken) record.issuedRefreshToken = issuedRefreshToken;
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
