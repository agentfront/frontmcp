// common/types/options/auth/interfaces.ts
// Explicit TypeScript interfaces for better IDE autocomplete
//
// These interfaces mirror the Zod schemas but provide better autocomplete
// experience in IDEs. The schemas in *.schema.ts files are used for runtime
// validation, while these interfaces are used for type hints.
//
// IMPORTANT: Keep these interfaces in sync with the Zod schemas.
// The typecheck.ts file will fail to compile if they get out of sync.

import { JSONWebKeySet, JWK } from '../../auth';
import type { RedisConfig } from '@frontmcp/auth';

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

/**
 * Public mode - No authentication required
 *
 * Use this for MCP servers that don't require authentication.
 * All tools and prompts are available to anyone.
 *
 * @example
 * ```typescript
 * auth: {
 *   mode: 'public',
 *   sessionTtl: 3600,
 * }
 * ```
 */
export interface PublicAuthOptionsInterface {
  mode: 'public';

  /**
   * Issuer identifier for anonymous JWTs
   * @default auto-derived from server URL
   */
  issuer?: string;

  /**
   * Anonymous session TTL in seconds
   * @default 3600 (1 hour)
   */
  sessionTtl?: number;

  /**
   * Scopes granted to anonymous sessions
   * @default ['anonymous']
   */
  anonymousScopes?: string[];

  /** Tool/prompt access configuration for anonymous users */
  publicAccess?: PublicAccessConfig;

  /**
   * JWKS for token verification
   * @default auto-generated
   */
  jwks?: JSONWebKeySet;

  /**
   * Private key for signing anonymous tokens
   * @default auto-generated
   */
  signKey?: JWK | Uint8Array;
}

/**
 * Transparent mode - Pass-through OAuth tokens from remote provider
 *
 * Use this when tokens come from an external OAuth provider
 * and you want to validate them without issuing new tokens.
 *
 * @example
 * ```typescript
 * auth: {
 *   mode: 'transparent',
 *   remote: {
 *     provider: 'https://auth.example.com',
 *   },
 * }
 * ```
 */
export interface TransparentAuthOptionsInterface {
  mode: 'transparent';

  /** Remote OAuth provider configuration (required) */
  remote: RemoteProviderConfig;

  /** Expected token audience */
  expectedAudience?: string | string[];

  /**
   * Required scopes for access
   * @default []
   */
  requiredScopes?: string[];

  /**
   * Allow anonymous fallback when no token is provided
   * @default false
   */
  allowAnonymous?: boolean;

  /**
   * Scopes granted to anonymous sessions (when allowAnonymous=true)
   * @default ['anonymous']
   */
  anonymousScopes?: string[];

  /** Public access config for anonymous users */
  publicAccess?: PublicAccessConfig;
}

/**
 * Orchestrated local mode - Full local authentication
 *
 * Use this when you want the MCP server to handle authentication
 * entirely without any external OAuth provider.
 *
 * @example
 * ```typescript
 * auth: {
 *   mode: 'orchestrated',
 *   type: 'local',
 *   allowDefaultPublic: false,
 * }
 * ```
 */
export interface OrchestratedLocalOptionsInterface {
  mode: 'orchestrated';
  type: 'local';

  /** Local signing configuration */
  local?: LocalSigningConfig;

  /**
   * Token storage configuration
   * @default { type: 'memory' }
   */
  tokenStorage?: TokenStorageConfig;

  /**
   * Allow default public access for unauthenticated requests
   * @default false
   */
  allowDefaultPublic?: boolean;

  /**
   * Scopes granted to anonymous sessions
   * @default ['anonymous']
   */
  anonymousScopes?: string[];

  /** Public access config */
  publicAccess?: PublicAccessConfig;

  /** Consent flow configuration */
  consent?: ConsentConfig;

  /** Federated auth configuration */
  federatedAuth?: FederatedAuthConfig;

  /** Token refresh settings */
  refresh?: TokenRefreshConfig;

  /** Expected token audience */
  expectedAudience?: string | string[];

  /** Incremental authorization configuration */
  incrementalAuth?: IncrementalAuthConfig;
}

/**
 * Orchestrated remote mode - Proxy to remote OAuth provider
 *
 * Use this when you want the MCP server to act as an OAuth client
 * that authenticates users via an external provider.
 *
 * @example
 * ```typescript
 * auth: {
 *   mode: 'orchestrated',
 *   type: 'remote',
 *   remote: {
 *     provider: 'https://auth.example.com',
 *     clientId: 'my-mcp-server',
 *   },
 * }
 * ```
 */
export interface OrchestratedRemoteOptionsInterface {
  mode: 'orchestrated';
  type: 'remote';

  /** Remote OAuth provider configuration (required) */
  remote: RemoteProviderConfig;

  /** Local signing configuration */
  local?: LocalSigningConfig;

  /**
   * Token storage configuration
   * @default { type: 'memory' }
   */
  tokenStorage?: TokenStorageConfig;

  /**
   * Allow default public access for unauthenticated requests
   * @default false
   */
  allowDefaultPublic?: boolean;

  /**
   * Scopes granted to anonymous sessions
   * @default ['anonymous']
   */
  anonymousScopes?: string[];

  /** Public access config */
  publicAccess?: PublicAccessConfig;

  /** Consent flow configuration */
  consent?: ConsentConfig;

  /** Federated auth configuration */
  federatedAuth?: FederatedAuthConfig;

  /** Token refresh settings */
  refresh?: TokenRefreshConfig;

  /** Expected token audience */
  expectedAudience?: string | string[];

  /** Incremental authorization configuration */
  incrementalAuth?: IncrementalAuthConfig;
}

// ============================================
// UNIFIED AUTH OPTIONS INTERFACE
// ============================================

/**
 * Authentication configuration for @FrontMcp decorator
 *
 * Choose one of:
 * - `mode: 'public'` - No authentication required
 * - `mode: 'transparent'` - Validate tokens from external OAuth provider
 * - `mode: 'orchestrated', type: 'local'` - Full local authentication
 * - `mode: 'orchestrated', type: 'remote'` - Proxy to external OAuth provider
 *
 * @example Public mode
 * ```typescript
 * auth: { mode: 'public' }
 * ```
 *
 * @example Transparent mode
 * ```typescript
 * auth: {
 *   mode: 'transparent',
 *   remote: { provider: 'https://auth.example.com' },
 * }
 * ```
 *
 * @example Orchestrated remote mode
 * ```typescript
 * auth: {
 *   mode: 'orchestrated',
 *   type: 'remote',
 *   remote: {
 *     provider: 'https://auth.example.com',
 *     clientId: 'my-client',
 *   },
 * }
 * ```
 */
export type AuthOptionsInterface =
  | PublicAuthOptionsInterface
  | TransparentAuthOptionsInterface
  | OrchestratedLocalOptionsInterface
  | OrchestratedRemoteOptionsInterface;

/**
 * Orchestrated mode options (local or remote)
 */
export type OrchestratedAuthOptionsInterface = OrchestratedLocalOptionsInterface | OrchestratedRemoteOptionsInterface;

/**
 * Authentication mode
 */
export type AuthMode = 'public' | 'transparent' | 'orchestrated';

/**
 * Orchestrated type
 */
export type OrchestratedType = 'local' | 'remote';
