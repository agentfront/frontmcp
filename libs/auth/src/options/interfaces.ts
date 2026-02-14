// options/interfaces.ts
// Explicit TypeScript interfaces for better IDE autocomplete
//
// These interfaces mirror the Zod schemas but provide better autocomplete
// experience in IDEs. The schemas in *.schema.ts files are used for runtime
// validation, while these interfaces are used for type hints.
//
// IMPORTANT: Keep these interfaces in sync with the Zod schemas.
// The typecheck.ts file will fail to compile if they get out of sync.

import { JSONWebKeySet, JWK } from '../common/jwt.types';
import type { RedisConfig } from '../session/transport-session.types';

// ============================================
// SHARED CONFIG INTERFACES
// ============================================

/**
 * Public access configuration for tools/prompts
 */
export interface PublicAccessConfig {
  /**
   * Allow all tools or explicit whitelist
   * @default 'all'
   */
  tools?: 'all' | string[];

  /**
   * Allow all prompts or explicit whitelist
   * @default 'all'
   */
  prompts?: 'all' | string[];

  /**
   * Rate limit per IP per minute
   * @default 60
   */
  rateLimit?: number;
}

/**
 * Local signing configuration (for orchestrated local type)
 */
export interface LocalSigningConfig {
  /**
   * Private key for signing orchestrated tokens
   * @default auto-generated
   */
  signKey?: JWK | Uint8Array;

  /**
   * JWKS for token verification
   * @default auto-generated
   */
  jwks?: JSONWebKeySet;

  /**
   * Issuer identifier for orchestrated tokens
   * @default auto-derived from server URL
   */
  issuer?: string;
}

/**
 * Remote OAuth provider configuration (for orchestrated remote and transparent)
 */
export interface RemoteProviderConfig {
  /**
   * OAuth provider base URL
   * @example 'https://auth.example.com'
   */
  provider: string;

  /** Provider display name */
  name?: string;

  /**
   * Unique identifier for this provider
   * @default derived from provider URL
   */
  id?: string;

  /**
   * Inline JWKS for offline token verification
   * Falls back to fetching from provider's /.well-known/jwks.json
   */
  jwks?: JSONWebKeySet;

  /** Custom JWKS URI if not at standard path */
  jwksUri?: string;

  /** Client ID for this MCP server (for orchestrated mode) */
  clientId?: string;

  /** Client secret (for confidential clients in orchestrated mode) */
  clientSecret?: string;

  /** Scopes to request from the upstream provider */
  scopes?: string[];

  /**
   * Enable Dynamic Client Registration (DCR)
   * @default false
   */
  dcrEnabled?: boolean;

  /** Authorization endpoint override */
  authEndpoint?: string;

  /** Token endpoint override */
  tokenEndpoint?: string;

  /** Registration endpoint override (for DCR) */
  registrationEndpoint?: string;

  /** User info endpoint override */
  userInfoEndpoint?: string;
}

/**
 * Token storage - in-memory
 */
export interface TokenStorageMemory {
  type: 'memory';
}

/**
 * Token storage - Redis
 */
export interface TokenStorageRedis {
  type: 'redis';
  config: RedisConfig;
}

/**
 * Token storage configuration for orchestrated mode
 */
export type TokenStorageConfig = TokenStorageMemory | TokenStorageRedis;

/**
 * Token refresh configuration
 */
export interface TokenRefreshConfig {
  /**
   * Enable automatic token refresh
   * @default true
   */
  enabled?: boolean;

  /**
   * Refresh token before expiry by this many seconds
   * @default 60
   */
  skewSeconds?: number;
}

/**
 * Behavior when a tool from a skipped (not yet authorized) app is called
 */
export type SkippedAppBehavior = 'anonymous' | 'require-auth';

/**
 * Consent configuration for tool selection
 */
export interface ConsentConfig {
  /**
   * Enable consent flow for tool selection
   * @default false
   */
  enabled?: boolean;

  /**
   * Group tools by app in the consent UI
   * @default true
   */
  groupByApp?: boolean;

  /**
   * Show tool descriptions in consent UI
   * @default true
   */
  showDescriptions?: boolean;

  /**
   * Allow selecting all tools at once
   * @default true
   */
  allowSelectAll?: boolean;

  /**
   * Require at least one tool to be selected
   * @default true
   */
  requireSelection?: boolean;

  /** Custom message to display on consent page */
  customMessage?: string;

  /**
   * Remember consent for future sessions
   * @default true
   */
  rememberConsent?: boolean;

  /** Tools to exclude from consent (always available) */
  excludedTools?: string[];

  /** Tools to always include in consent (pre-selected) */
  defaultSelectedTools?: string[];
}

/**
 * Federated authentication configuration
 */
export interface FederatedAuthConfig {
  /**
   * How strictly to validate the OAuth state parameter on provider callbacks.
   * - 'strict': Validates the full state parameter matches the session (recommended)
   * - 'format': Only validates the state format is correct
   */
  stateValidation: 'strict' | 'format';
}

/**
 * Progressive/Incremental authorization configuration
 */
export interface IncrementalAuthConfig {
  /**
   * Enable incremental (progressive) authorization
   * @default true
   */
  enabled?: boolean;

  /**
   * Behavior when a tool from a skipped app is called
   * @default 'anonymous'
   */
  skippedAppBehavior?: SkippedAppBehavior;

  /**
   * Allow users to skip app authorization during initial auth flow
   * @default true
   */
  allowSkip?: boolean;

  /**
   * Show all apps in a single authorization page (vs step-by-step)
   * @default true
   */
  showAllAppsAtOnce?: boolean;
}

// ============================================
// AUTH MODE INTERFACES
// ============================================

export interface PublicAuthOptionsInterface {
  mode: 'public';
  issuer?: string;
  sessionTtl?: number;
  anonymousScopes?: string[];
  publicAccess?: PublicAccessConfig;
  jwks?: JSONWebKeySet;
  signKey?: JWK | Uint8Array;
}

export interface TransparentAuthOptionsInterface {
  mode: 'transparent';
  remote: RemoteProviderConfig;
  expectedAudience?: string | string[];
  requiredScopes?: string[];
  allowAnonymous?: boolean;
  anonymousScopes?: string[];
  publicAccess?: PublicAccessConfig;
}

export interface OrchestratedLocalOptionsInterface {
  mode: 'orchestrated';
  type: 'local';
  local?: LocalSigningConfig;
  tokenStorage?: TokenStorageConfig;
  allowDefaultPublic?: boolean;
  anonymousScopes?: string[];
  publicAccess?: PublicAccessConfig;
  consent?: ConsentConfig;
  federatedAuth?: FederatedAuthConfig;
  refresh?: TokenRefreshConfig;
  expectedAudience?: string | string[];
  incrementalAuth?: IncrementalAuthConfig;
}

export interface OrchestratedRemoteOptionsInterface {
  mode: 'orchestrated';
  type: 'remote';
  remote: RemoteProviderConfig;
  local?: LocalSigningConfig;
  tokenStorage?: TokenStorageConfig;
  allowDefaultPublic?: boolean;
  anonymousScopes?: string[];
  publicAccess?: PublicAccessConfig;
  consent?: ConsentConfig;
  federatedAuth?: FederatedAuthConfig;
  refresh?: TokenRefreshConfig;
  expectedAudience?: string | string[];
  incrementalAuth?: IncrementalAuthConfig;
}

// ============================================
// UNIFIED AUTH OPTIONS INTERFACE
// ============================================

export type AuthOptionsInterface =
  | PublicAuthOptionsInterface
  | TransparentAuthOptionsInterface
  | OrchestratedLocalOptionsInterface
  | OrchestratedRemoteOptionsInterface;

export type OrchestratedAuthOptionsInterface = OrchestratedLocalOptionsInterface | OrchestratedRemoteOptionsInterface;

export type AuthMode = 'public' | 'transparent' | 'orchestrated';

export type OrchestratedType = 'local' | 'remote';
