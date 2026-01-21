/**
 * Federated Auth Session
 *
 * Manages state during multi-provider OAuth flows where a user needs to
 * authenticate with multiple upstream OAuth providers sequentially.
 *
 * Flow:
 * 1. User selects providers on federated login page
 * 2. System stores FederatedAuthSession with provider queue
 * 3. User is redirected to first provider's OAuth authorize endpoint
 * 4. After provider callback, tokens are stored and next provider is processed
 * 5. When all providers complete, FrontMCP JWT is issued
 */

import { randomUUID } from '@frontmcp/utils';

/**
 * PKCE data for upstream provider OAuth flow
 */
export interface ProviderPkce {
  /** Code verifier (used in token exchange) */
  verifier: string;
  /** Code challenge (sent to authorize endpoint) */
  challenge: string;
  /** Challenge method (always S256) */
  method: 'S256';
}

/**
 * Token data received from an upstream provider
 */
export interface ProviderTokens {
  /** Access token */
  accessToken: string;
  /** Refresh token (if provided) */
  refreshToken?: string;
  /** Token expiration (epoch ms) */
  expiresAt?: number;
  /** Token type (usually 'Bearer') */
  tokenType?: string;
  /** Granted scopes */
  scopes?: string[];
  /** ID token (for OIDC providers) */
  idToken?: string;
}

/**
 * User info from an upstream provider
 */
export interface ProviderUserInfo {
  /** Subject identifier from provider */
  sub: string;
  /** User email */
  email?: string;
  /** Display name */
  name?: string;
  /** Profile picture URL */
  picture?: string;
  /** Additional claims */
  claims?: Record<string, unknown>;
}

/**
 * Completed provider entry in the federated session
 */
export interface CompletedProvider {
  /** Provider ID */
  providerId: string;
  /** OAuth tokens from the provider */
  tokens: ProviderTokens;
  /** User info from the provider */
  userInfo?: ProviderUserInfo;
  /** Timestamp when provider auth completed */
  completedAt: number;
}

/**
 * Federated Auth Session state
 *
 * Stored during multi-provider OAuth flow to track progress
 */
export interface FederatedAuthSession {
  /** Unique session ID */
  id: string;

  /** Original pending auth ID (from /oauth/authorize request) */
  pendingAuthId: string;

  /** Client ID that initiated the auth flow */
  clientId: string;

  /** Redirect URI for final callback */
  redirectUri: string;

  /** Requested scopes for FrontMCP token */
  scopes: string[];

  /** Original state parameter from client */
  state?: string;

  /** Resource/audience for final token */
  resource?: string;

  /** User info (email, name) from initial login form */
  userInfo: {
    email?: string;
    name?: string;
    sub?: string;
  };

  /** PKCE challenge for final FrontMCP token exchange */
  frontmcpPkce: {
    challenge: string;
    method: 'S256';
  };

  /** Queue of provider IDs remaining to auth */
  providerQueue: string[];

  /** Map of completed providers with their tokens */
  completedProviders: Map<string, CompletedProvider>;

  /** Currently active provider (being authenticated) */
  currentProviderId?: string;

  /** PKCE data for current provider's OAuth flow */
  currentProviderPkce?: ProviderPkce;

  /** State parameter for current provider's OAuth flow */
  currentProviderState?: string;

  /** Session creation timestamp */
  createdAt: number;

  /** Session expiration timestamp */
  expiresAt: number;
}

/**
 * Serializable version of FederatedAuthSession for storage
 */
export interface FederatedAuthSessionRecord {
  id: string;
  pendingAuthId: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state?: string;
  resource?: string;
  userInfo: {
    email?: string;
    name?: string;
    sub?: string;
  };
  frontmcpPkce: {
    challenge: string;
    method: 'S256';
  };
  providerQueue: string[];
  completedProviders: Array<[string, CompletedProvider]>;
  currentProviderId?: string;
  currentProviderPkce?: ProviderPkce;
  currentProviderState?: string;
  createdAt: number;
  expiresAt: number;
}

/**
 * Federated Auth Session Store Interface
 */
export interface FederatedAuthSessionStore {
  /** Store a federated auth session */
  store(session: FederatedAuthSession): Promise<void>;

  /** Get a federated auth session by ID */
  get(id: string): Promise<FederatedAuthSession | null>;

  /** Delete a federated auth session */
  delete(id: string): Promise<void>;

  /** Update a federated auth session */
  update(session: FederatedAuthSession): Promise<void>;
}

/**
 * Convert FederatedAuthSession to serializable record
 */
export function toSessionRecord(session: FederatedAuthSession): FederatedAuthSessionRecord {
  return {
    ...session,
    completedProviders: Array.from(session.completedProviders.entries()),
  };
}

/**
 * Convert serializable record back to FederatedAuthSession
 */
export function fromSessionRecord(record: FederatedAuthSessionRecord): FederatedAuthSession {
  return {
    ...record,
    completedProviders: new Map(record.completedProviders),
  };
}

/**
 * In-Memory Federated Auth Session Store
 *
 * Development/testing implementation for federated auth session storage.
 */
export class InMemoryFederatedAuthSessionStore implements FederatedAuthSessionStore {
  private readonly sessions = new Map<string, FederatedAuthSessionRecord>();

  /** Default TTL for sessions (15 minutes) */
  private readonly sessionTtlMs = 15 * 60 * 1000;

  /** Cleanup interval timer */
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor() {
    // Start cleanup timer
    this.cleanupTimer = setInterval(() => {
      void this.cleanup();
    }, 60000);

    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  async store(session: FederatedAuthSession): Promise<void> {
    const record = toSessionRecord(session);
    this.sessions.set(session.id, record);
  }

  async get(id: string): Promise<FederatedAuthSession | null> {
    const record = this.sessions.get(id);
    if (!record) {
      return null;
    }

    // Check expiration
    if (Date.now() > record.expiresAt) {
      this.sessions.delete(id);
      return null;
    }

    return fromSessionRecord(record);
  }

  async delete(id: string): Promise<void> {
    this.sessions.delete(id);
  }

  async update(session: FederatedAuthSession): Promise<void> {
    const record = toSessionRecord(session);
    this.sessions.set(session.id, record);
  }

  /**
   * Clean up expired sessions
   */
  async cleanup(): Promise<void> {
    const now = Date.now();
    for (const [id, record] of this.sessions) {
      if (now > record.expiresAt) {
        this.sessions.delete(id);
      }
    }
  }

  /**
   * Stop the cleanup timer
   */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  /**
   * Create a new federated auth session
   */
  createSession(params: {
    pendingAuthId: string;
    clientId: string;
    redirectUri: string;
    scopes: string[];
    state?: string;
    resource?: string;
    userInfo: { email?: string; name?: string; sub?: string };
    frontmcpPkce: { challenge: string; method: 'S256' };
    providerIds: string[];
  }): FederatedAuthSession {
    const now = Date.now();
    return {
      id: randomUUID(),
      pendingAuthId: params.pendingAuthId,
      clientId: params.clientId,
      redirectUri: params.redirectUri,
      scopes: params.scopes,
      state: params.state,
      resource: params.resource,
      userInfo: params.userInfo,
      frontmcpPkce: params.frontmcpPkce,
      providerQueue: [...params.providerIds],
      completedProviders: new Map(),
      createdAt: now,
      expiresAt: now + this.sessionTtlMs,
    };
  }

  /**
   * Get count (for testing/monitoring)
   */
  get size(): number {
    return this.sessions.size;
  }

  /**
   * Clear all sessions (for testing)
   */
  clear(): void {
    this.sessions.clear();
  }
}

/**
 * Create a new federated auth session object
 *
 * This is a standalone factory function that creates a FederatedAuthSession
 * without requiring a store instance. Use this for type-safe session creation.
 *
 * @param params Session parameters
 * @param ttlMs Session TTL in milliseconds (default: 15 minutes)
 */
export function createFederatedAuthSession(
  params: {
    pendingAuthId: string;
    clientId: string;
    redirectUri: string;
    scopes: string[];
    state?: string;
    resource?: string;
    userInfo: { email?: string; name?: string; sub?: string };
    frontmcpPkce: { challenge: string; method: 'S256' };
    providerIds: string[];
  },
  ttlMs = 15 * 60 * 1000,
): FederatedAuthSession {
  const now = Date.now();
  return {
    id: randomUUID(),
    pendingAuthId: params.pendingAuthId,
    clientId: params.clientId,
    redirectUri: params.redirectUri,
    scopes: params.scopes,
    state: params.state,
    resource: params.resource,
    userInfo: params.userInfo,
    frontmcpPkce: params.frontmcpPkce,
    providerQueue: [...params.providerIds],
    completedProviders: new Map(),
    createdAt: now,
    expiresAt: now + ttlMs,
  };
}

/**
 * Helper to check if all providers have been authenticated
 */
export function isSessionComplete(session: FederatedAuthSession): boolean {
  return session.providerQueue.length === 0 && !session.currentProviderId;
}

/**
 * Helper to get the next provider to authenticate
 */
export function getNextProvider(session: FederatedAuthSession): string | undefined {
  if (session.currentProviderId) {
    return session.currentProviderId;
  }
  return session.providerQueue[0];
}

/**
 * Helper to mark current provider as complete and move to next
 */
export function completeCurrentProvider(
  session: FederatedAuthSession,
  tokens: ProviderTokens,
  userInfo?: ProviderUserInfo,
): void {
  if (!session.currentProviderId) {
    throw new Error('No current provider to complete');
  }

  // Store completed provider
  session.completedProviders.set(session.currentProviderId, {
    providerId: session.currentProviderId,
    tokens,
    userInfo,
    completedAt: Date.now(),
  });

  // Clear current provider
  session.currentProviderId = undefined;
  session.currentProviderPkce = undefined;
  session.currentProviderState = undefined;
}

/**
 * Helper to start authentication with next provider
 */
export function startNextProvider(session: FederatedAuthSession, pkce: ProviderPkce, state: string): string {
  if (session.currentProviderId) {
    throw new Error('Cannot start next provider while current is in progress');
  }

  if (session.providerQueue.length === 0) {
    throw new Error('No more providers in queue');
  }

  // Pop from queue and set as current
  const providerId = session.providerQueue.shift()!;
  session.currentProviderId = providerId;
  session.currentProviderPkce = pkce;
  session.currentProviderState = state;

  return providerId;
}
