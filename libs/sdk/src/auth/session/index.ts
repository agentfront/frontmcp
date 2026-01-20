// Transport session architecture
export * from './transport-session.types';
export { TransportSessionManager, InMemorySessionStore } from './transport-session.manager';
export { RedisSessionStore, RedisSessionStoreConfig } from './redis-session.store';
export { VercelKvSessionStore, VercelKvSessionConfig } from './vercel-kv-session.store';

// Session store factory
export { createSessionStore, createSessionStoreSync, createPubsubStore } from './session-store.factory';

// Session security utilities
export {
  SessionRateLimiter,
  SessionRateLimiterConfig,
  RateLimitResult,
  defaultSessionRateLimiter,
} from './session-rate-limiter';

export {
  signSession,
  verifySession,
  verifyOrParseSession,
  isSignedSession,
  SignedSession,
  SessionSigningConfig,
} from './session-crypto';

// Authorization store for OAuth flows (re-exported from @frontmcp/auth)
export {
  // Classes
  InMemoryAuthorizationStore,
  RedisAuthorizationStore,
  // Functions
  verifyPkce,
  generatePkceChallenge,
  // Schemas
  pkceChallengeSchema,
  authorizationCodeRecordSchema,
} from '@frontmcp/auth';
export type {
  AuthorizationStore,
  PkceChallenge,
  AuthorizationCodeRecord,
  PendingAuthorizationRecord,
  RefreshTokenRecord,
  ConsentStateRecord,
  FederatedLoginStateRecord,
} from '@frontmcp/auth';

// Orchestrated token store for upstream provider tokens
export { InMemoryOrchestratedTokenStore, type InMemoryOrchestratedTokenStoreOptions } from './orchestrated-token.store';

// Federated auth session for multi-provider OAuth flows
export {
  InMemoryFederatedAuthSessionStore,
  toSessionRecord,
  fromSessionRecord,
  isSessionComplete,
  getNextProvider,
  completeCurrentProvider,
  startNextProvider,
} from './federated-auth.session';
export type {
  FederatedAuthSession,
  FederatedAuthSessionRecord,
  FederatedAuthSessionStore,
  ProviderPkce,
  ProviderTokens,
  ProviderUserInfo,
  CompletedProvider,
} from './federated-auth.session';
