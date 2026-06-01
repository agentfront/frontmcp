// options/shared.schemas.ts
// Shared configuration schemas used across auth modes

import { z } from '@frontmcp/lazy-zod';

import { jsonWebKeySetSchema, jwkSchema } from '../common/jwt.types';
import { redisConfigSchema, type RedisConfig } from '../session/transport-session.types';

// ============================================
// PUBLIC ACCESS CONFIG
// ============================================

/**
 * Public access configuration for tools/prompts
 */
export const publicAccessConfigSchema = z.object({
  /**
   * Allow all tools or explicit whitelist
   * @default 'all'
   */
  tools: z.union([z.literal('all'), z.array(z.string())]).default('all'),

  /**
   * Allow all prompts or explicit whitelist
   * @default 'all'
   */
  prompts: z.union([z.literal('all'), z.array(z.string())]).default('all'),

  /**
   * Rate limit per IP per minute
   * @default 60
   */
  rateLimit: z.number().default(60),
});

export type PublicAccessConfig = z.infer<typeof publicAccessConfigSchema>;
export type PublicAccessConfigInput = z.input<typeof publicAccessConfigSchema>;

// ============================================
// LOCAL SIGNING CONFIG
// ============================================

/**
 * Local signing configuration (for local auth mode)
 */
export const localSigningConfigSchema = z.object({
  /**
   * Private key for signing tokens
   * @default auto-generated
   */
  signKey: jwkSchema.or(z.instanceof(Uint8Array)).optional(),

  /**
   * JWKS for token verification
   * @default auto-generated
   */
  jwks: jsonWebKeySetSchema.optional(),

  /**
   * Issuer identifier for tokens
   * @default auto-derived from server URL
   */
  issuer: z.string().optional(),
});

export type LocalSigningConfig = z.infer<typeof localSigningConfigSchema>;
export type LocalSigningConfigInput = z.input<typeof localSigningConfigSchema>;

// ============================================
// PROVIDER CONFIG (advanced sub-object)
// ============================================

/**
 * Advanced provider configuration options.
 * These are less commonly used and are grouped into an optional sub-object.
 */
export const providerConfigSchema = z.object({
  /** Provider display name */
  name: z.string().optional(),

  /**
   * Unique identifier for this provider
   * @default derived from provider URL
   */
  id: z.string().optional(),

  /**
   * Inline JWKS for offline token verification
   * Falls back to fetching from provider's /.well-known/jwks.json
   */
  jwks: jsonWebKeySetSchema.optional(),

  /** Custom JWKS URI if not at standard path */
  jwksUri: z.string().url().optional(),

  /**
   * Enable Dynamic Client Registration (DCR)
   * @default false
   */
  dcrEnabled: z.boolean().default(false),

  /** Authorization endpoint override */
  authEndpoint: z.string().url().optional(),

  /** Token endpoint override */
  tokenEndpoint: z.string().url().optional(),

  /** Registration endpoint override (for DCR) */
  registrationEndpoint: z.string().url().optional(),

  /** User info endpoint override */
  userInfoEndpoint: z.string().url().optional(),
});

export type ProviderConfig = z.infer<typeof providerConfigSchema>;
export type ProviderConfigInput = z.input<typeof providerConfigSchema>;

// ============================================
// REMOTE PROVIDER CONFIG (legacy, kept for internal use)
// ============================================

/**
 * Remote OAuth provider configuration (internal, full flat shape)
 * Used internally after flattening for compatibility.
 */
export const remoteProviderConfigSchema = z.object({
  /**
   * OAuth provider base URL
   * @example 'https://auth.example.com'
   */
  provider: z.string().url(),

  /**
   * Provider display name
   */
  name: z.string().optional(),

  /**
   * Unique identifier for this provider
   * @default derived from provider URL
   */
  id: z.string().optional(),

  /**
   * Inline JWKS for offline token verification
   * Falls back to fetching from provider's /.well-known/jwks.json
   */
  jwks: jsonWebKeySetSchema.optional(),

  /**
   * Custom JWKS URI if not at standard path
   */
  jwksUri: z.string().url().optional(),

  /**
   * Client ID for this MCP server
   */
  clientId: z.string().optional(),

  /**
   * Client secret (for confidential clients)
   */
  clientSecret: z.string().optional(),

  /**
   * Scopes to request from the upstream provider
   */
  scopes: z.array(z.string()).optional(),

  /**
   * Enable Dynamic Client Registration (DCR)
   * @default false
   */
  dcrEnabled: z.boolean().default(false),

  /**
   * Authorization endpoint override
   */
  authEndpoint: z.string().url().optional(),

  /**
   * Token endpoint override
   */
  tokenEndpoint: z.string().url().optional(),

  /**
   * Registration endpoint override (for DCR)
   */
  registrationEndpoint: z.string().url().optional(),

  /**
   * User info endpoint override
   */
  userInfoEndpoint: z.string().url().optional(),
});

export type RemoteProviderConfig = z.infer<typeof remoteProviderConfigSchema>;
export type RemoteProviderConfigInput = z.input<typeof remoteProviderConfigSchema>;

// ============================================
// UPSTREAM PROVIDER CONFIG (local-mode federation)
// ============================================

/**
 * Declarative configuration for an upstream OAuth provider that the local-mode
 * MCP server orchestrates (e.g. GitHub, Slack, Jira). When `providers` are
 * declared on `mode: 'local'`, FrontMCP federates them at `/oauth/authorize`,
 * exchanges each provider's code at `/oauth/provider/{id}/callback`, stores the
 * tokens encrypted, and exposes them to tools via `this.orchestration.getToken(id)`.
 *
 * This mirrors the internal `UpstreamProviderConfig` consumed by
 * `LocalPrimaryAuth.registerProvider`. The endpoint fields accept the canonical
 * `authorizationEndpoint`/`tokenEndpoint` names as well as the shorter
 * `authorizeUrl`/`tokenUrl` aliases for ergonomics — at least one of each pair
 * must be provided. No PII is stored: only provider tokens (encrypted at rest).
 */
export const upstreamProviderSchema = z
  .object({
    /** Stable provider id (e.g. `'github'`). Used in `this.orchestration.getToken(id)`. */
    id: z.string().min(1),
    /** Human-readable display name. Defaults to `id` when omitted. */
    name: z.string().optional(),
    /** Authorization endpoint (canonical name). */
    authorizationEndpoint: z.string().url().optional(),
    /** Authorization endpoint (alias for {@link authorizationEndpoint}). */
    authorizeUrl: z.string().url().optional(),
    /** Token endpoint (canonical name). */
    tokenEndpoint: z.string().url().optional(),
    /** Token endpoint (alias for {@link tokenEndpoint}). */
    tokenUrl: z.string().url().optional(),
    /** OAuth client id issued by the upstream provider. */
    clientId: z.string().min(1),
    /** OAuth client secret (confidential clients). */
    clientSecret: z.string().optional(),
    /** Scopes to request from the upstream provider. */
    scopes: z.array(z.string()).optional(),
    /** User info endpoint (optional, used to enrich the session identity). */
    userInfoEndpoint: z.string().url().optional(),
    /** JWKS URI for upstream id_token validation (optional). */
    jwksUri: z.string().url().optional(),
  })
  .refine((p) => !!(p.authorizationEndpoint ?? p.authorizeUrl), {
    message: 'authorizationEndpoint (or authorizeUrl) is required',
    path: ['authorizationEndpoint'],
  })
  .refine((p) => !!(p.tokenEndpoint ?? p.tokenUrl), {
    message: 'tokenEndpoint (or tokenUrl) is required',
    path: ['tokenEndpoint'],
  });

export type UpstreamProviderOptions = z.infer<typeof upstreamProviderSchema>;
export type UpstreamProviderOptionsInput = z.input<typeof upstreamProviderSchema>;

// ============================================
// FLATTENED REMOTE FIELDS
// Shared between transparent and remote modes
// ============================================

/**
 * Flattened remote provider fields for top-level use in auth schemas.
 * Basic fields (provider, clientId, clientSecret, scopes) are at top level.
 * Advanced fields are in the optional providerConfig sub-object.
 */
export const flatRemoteProviderFields = {
  /**
   * OAuth provider base URL (required)
   * @example 'https://auth.example.com'
   */
  provider: z.string().url(),

  /** Client ID for this MCP server */
  clientId: z.string().optional(),

  /** Client secret (for confidential clients) */
  clientSecret: z.string().optional(),

  /** Scopes to request from the upstream provider */
  scopes: z.array(z.string()).optional(),

  /** Advanced provider configuration */
  providerConfig: providerConfigSchema.optional(),
};

// ============================================
// TOKEN STORAGE CONFIG (BC-030: simplified)
// ============================================

/**
 * SQLite configuration for token storage.
 *
 * Mirrors the SQLite options consumed by `@frontmcp/storage-sqlite`. Unlike the
 * SDK's transport/session SQLite config, `path` is REQUIRED here: the auth layer
 * has no default-path resolver, so persistence is opt-in and explicit.
 */
export const tokenStorageSqliteSchema = z.object({
  /** Path to the `.sqlite` database file used for auth persistence. */
  path: z.string().min(1),

  /**
   * Encryption configuration for at-rest encryption of stored values.
   * Independent of the AES-GCM blob encryption already applied to upstream
   * provider tokens by the orchestrated-token store.
   */
  encryption: z
    .object({
      secret: z.string().min(1),
    })
    .optional(),

  /**
   * Interval in milliseconds for purging expired keys.
   * @default 60000
   */
  ttlCleanupIntervalMs: z.number().int().nonnegative().optional(),

  /**
   * Enable WAL mode for better read concurrency.
   * @default true
   */
  walMode: z.boolean().optional(),
});

export type TokenStorageSqliteConfig = z.infer<typeof tokenStorageSqliteSchema>;

/**
 * Token storage configuration for local/remote modes.
 *
 * - `'memory'` — in-memory storage (default; lost on restart).
 * - `{ redis }` — Redis-backed persistence.
 * - `{ sqlite }` — local SQLite-file persistence (survives restart, no Redis).
 */
export const tokenStorageConfigSchema = z.union([
  z.literal('memory'),
  z.object({ redis: redisConfigSchema }),
  z.object({ sqlite: tokenStorageSqliteSchema }),
]);

export type TokenStorageConfig = z.infer<typeof tokenStorageConfigSchema>;
export type TokenStorageConfigInput = z.input<typeof tokenStorageConfigSchema>;

// ============================================
// TOKEN REFRESH CONFIG
// ============================================

/**
 * Token refresh configuration
 */
export const tokenRefreshConfigSchema = z.object({
  /**
   * Enable automatic token refresh
   * @default true
   */
  enabled: z.boolean().default(true),

  /**
   * Refresh token before expiry by this many seconds
   * @default 60
   */
  skewSeconds: z.number().default(60),
});

export type TokenRefreshConfig = z.infer<typeof tokenRefreshConfigSchema>;
export type TokenRefreshConfigInput = z.input<typeof tokenRefreshConfigSchema>;

// ============================================
// SKIPPED APP BEHAVIOR
// ============================================

/**
 * Behavior when a tool from a skipped (not yet authorized) app is called
 */
export const skippedAppBehaviorSchema = z.enum(['anonymous', 'require-auth']);

export type SkippedAppBehavior = z.infer<typeof skippedAppBehaviorSchema>;

// ============================================
// CONSENT CONFIG
// ============================================

/**
 * Consent configuration for tool selection
 * Allows users to choose which MCP tools to expose to the LLM
 */
export const consentConfigSchema = z.object({
  /**
   * Enable consent flow for tool selection
   * When enabled, users can choose which tools to expose to the LLM
   * @default false
   */
  enabled: z.boolean().default(false),

  /**
   * Group tools by app in the consent UI
   * @default true
   */
  groupByApp: z.boolean().default(true),

  /**
   * Show tool descriptions in consent UI
   * @default true
   */
  showDescriptions: z.boolean().default(true),

  /**
   * Allow selecting all tools at once
   * @default true
   */
  allowSelectAll: z.boolean().default(true),

  /**
   * Require at least one tool to be selected
   * @default true
   */
  requireSelection: z.boolean().default(true),

  /**
   * Custom message to display on consent page
   */
  customMessage: z.string().optional(),

  /**
   * Remember consent for future sessions
   * @default true
   */
  rememberConsent: z.boolean().default(true),

  /**
   * Tools to exclude from consent (always available)
   * Useful for essential tools that should always be accessible
   */
  excludedTools: z.array(z.string()).optional(),

  /**
   * Tools to always include in consent (pre-selected)
   */
  defaultSelectedTools: z.array(z.string()).optional(),
});

export type ConsentConfig = z.infer<typeof consentConfigSchema>;
export type ConsentConfigInput = z.input<typeof consentConfigSchema>;

// ============================================
// FEDERATED AUTH CONFIG
// ============================================

/**
 * Federated authentication configuration
 */
export const federatedAuthConfigSchema = z.object({
  /**
   * How strictly to validate the OAuth state parameter on provider callbacks.
   * - 'strict': require exact match to stored state (default, safest)
   * - 'format': validate only "federated:{sessionId}:{nonce}" format
   * @default 'strict'
   */
  stateValidation: z.enum(['strict', 'format']).default('strict'),

  /**
   * Minimum number of upstream providers a user must link before a FrontMCP JWT
   * is minted. The federated callback refuses to issue a token until at least
   * this many providers have been authorized. Defaults to `1` at runtime when
   * `providers` are configured (i.e. "no JWT until ≥1 linked"). Left optional
   * here so existing configs without `providers` are completely unaffected.
   */
  minProviders: z.number().int().positive().optional(),

  /**
   * Provider ids that MUST be among the linked providers before a JWT is minted.
   * The federated callback rejects the login unless every id listed here is in
   * the user's selected providers. Optional — omit to allow any combination that
   * satisfies {@link minProviders}.
   */
  requiredProviders: z.array(z.string()).optional(),
});

export type FederatedAuthConfig = z.infer<typeof federatedAuthConfigSchema>;
export type FederatedAuthConfigInput = z.input<typeof federatedAuthConfigSchema>;

// ============================================
// INCREMENTAL AUTH CONFIG
// ============================================

/**
 * Progressive/Incremental authorization configuration
 * Allows users to authorize apps one at a time after initial auth
 */
export const incrementalAuthConfigSchema = z.object({
  /**
   * Enable incremental (progressive) authorization
   * When enabled, users can skip app authorizations during initial auth
   * and authorize individual apps later when needed
   * @default true
   */
  enabled: z.boolean().default(true),

  /**
   * Behavior when a tool from a skipped app is called
   * - 'anonymous': If app supports anonymous access, use it; otherwise require auth
   * - 'require-auth': Always require authorization (return auth_url)
   * @default 'anonymous'
   */
  skippedAppBehavior: skippedAppBehaviorSchema.default('anonymous'),

  /**
   * Allow users to skip app authorization during initial auth flow
   * @default true
   */
  allowSkip: z.boolean().default(true),

  /**
   * Show all apps in a single authorization page (vs step-by-step)
   * @default true
   */
  showAllAppsAtOnce: z.boolean().default(true),
});

export type IncrementalAuthConfig = z.infer<typeof incrementalAuthConfigSchema>;
export type IncrementalAuthConfigInput = z.input<typeof incrementalAuthConfigSchema>;

// ============================================
// CIMD (Client ID Metadata Documents) CONFIG
// Re-exported from sibling module
// ============================================
export {
  cimdCacheConfigSchema,
  cimdSecurityConfigSchema,
  cimdNetworkConfigSchema,
  cimdConfigSchema,
  type CimdCacheConfig,
  type CimdSecurityConfig,
  type CimdNetworkConfig,
  type CimdConfig,
  type CimdConfigInput,
} from '../cimd';

// Re-export types used from external modules
export type { RedisConfig };
