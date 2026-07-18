// options/shared.schemas.ts
// Shared configuration schemas used across auth modes

import { z } from '@frontmcp/lazy-zod';

import { jsonWebKeySetSchema, jwkSchema } from '../common/jwt.types';
import { redisConfigSchema, type RedisConfig } from '../session/transport-session.types';
import type { SecureStoreCustomBackend } from './interfaces';

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
   * Additional `iss` values to trust beyond the provider issuer URL.
   *
   * SECURITY: trusted verbatim — set only to issuers you control (e.g. a
   * gateway that re-mints tokens), never derived from request or token data.
   */
  additionalIssuers: z.array(z.string()).optional(),

  /**
   * Validate the token's `iss` claim against the provider issuer (and
   * {@link additionalIssuers}). Defaults to `true`.
   *
   * SECURITY: `false` disables issuer verification entirely — any token signed
   * by a provider JWKS key is accepted regardless of issuer. Only for a trusted
   * gateway whose re-minted issuer cannot be enumerated; prefer
   * `additionalIssuers` when the issuer set is known.
   */
  verifyIssuer: z.boolean().optional(),

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
  })
  // Reject setting BOTH the canonical field and its alias — that masks a likely
  // misconfiguration (which URL wins is non-obvious).
  .refine((p) => !(p.authorizationEndpoint && p.authorizeUrl), {
    message: 'provide only one of authorizationEndpoint or authorizeUrl',
    path: ['authorizationEndpoint'],
  })
  .refine((p) => !(p.tokenEndpoint && p.tokenUrl), {
    message: 'provide only one of tokenEndpoint or tokenUrl',
    path: ['tokenEndpoint'],
  });

export type UpstreamProviderOptions = z.infer<typeof upstreamProviderSchema>;
export type UpstreamProviderOptionsInput = z.input<typeof upstreamProviderSchema>;

// ============================================
// LOCAL-AS DCR (Dynamic Client Registration) CONFIG
// ============================================

/**
 * A pre-registered (trusted) OAuth client for the LOCAL Authorization Server.
 *
 * Seeded into the in-memory client registry at startup so the authorize/token
 * flows accept it WITHOUT requiring a Dynamic Client Registration round-trip.
 * This is the declarative way to ship a known `client_id` (e.g. an internal
 * dashboard) without leaving `POST /oauth/register` open.
 *
 * No PII: only OAuth client metadata (ids, redirect URIs, grant/response types)
 * is stored — never end-user identity.
 */
export const localDcrClientSchema = z.object({
  /** Stable, pre-assigned client identifier the client authenticates with. */
  clientId: z.string().min(1),
  /**
   * Confidential-client secret. Omit for public clients
   * (`token_endpoint_auth_method: 'none'`, the default).
   */
  clientSecret: z.string().min(1).optional(),
  /** Exact redirect URIs this client is allowed to use (at least one). */
  redirectUris: z.array(z.string().url()).min(1, 'At least one redirect_uri is required'),
  /** Human-readable name shown on consent/login screens. */
  clientName: z.string().optional(),
  /**
   * Token-endpoint auth method. Defaults to `'none'` (public PKCE client).
   */
  tokenEndpointAuthMethod: z.enum(['none', 'client_secret_basic', 'client_secret_post']).default('none'),
  /** Allowed grant types. Defaults to `['authorization_code']`. */
  grantTypes: z.array(z.enum(['authorization_code', 'refresh_token'])).default(['authorization_code']),
  /** Allowed response types. Defaults to `['code']`. */
  responseTypes: z.array(z.enum(['code'])).default(['code']),
  /** Optional space-delimited default scope string. */
  scope: z.string().optional(),
});

export type LocalDcrClientConfig = z.infer<typeof localDcrClientSchema>;
export type LocalDcrClientConfigInput = z.input<typeof localDcrClientSchema>;

/**
 * Declarative control surface for the LOCAL Authorization Server's Dynamic
 * Client Registration endpoint (`POST /oauth/register`, RFC 7591) and the
 * client allowlist enforced at `/oauth/authorize`.
 *
 * IMPORTANT: this is the LOCAL-AS DCR config and is entirely distinct from the
 * upstream-provider `dcrEnabled`/`registrationEndpoint` fields on
 * {@link providerConfigSchema}/{@link remoteProviderConfigSchema}, which govern
 * registering THIS server as a client AGAINST an upstream IdP and are not read
 * by the local AS.
 *
 * Every field is optional. Omitting the whole `dcr` block preserves the
 * historical behavior exactly: DCR is enabled in dev and disabled in
 * production (via `isProduction()`), no allowlist is enforced, and no initial
 * access token is required.
 */
export const localDcrConfigSchema = z.object({
  /**
   * Whether `POST /oauth/register` is mounted/active and whether
   * `registration_endpoint` is advertised in AS metadata.
   *
   * When unset (default), the historical guard applies: enabled in
   * development, disabled in production. Set explicitly to force it on or off
   * regardless of `NODE_ENV`.
   */
  enabled: z.boolean().optional(),
  /**
   * Allowlist of redirect URIs. Each entry is matched EXACTLY or as a simple
   * glob (`*` matches any run of characters). When set, both DCR registrations
   * and `/oauth/authorize` requests are rejected unless their `redirect_uri`
   * matches an entry. When unset, no redirect_uri allowlist is enforced.
   */
  allowedRedirectUris: z.array(z.string().min(1)).optional(),
  /**
   * Allowlist of client ids. When set, only these `client_id`s may register
   * (DCR registrations are forced to one of these ids) or be used at
   * `/oauth/authorize`. When unset, any client id is accepted (subject to the
   * other checks). CIMD URL client ids are validated by the CIMD layer and are
   * exempt from this allowlist.
   */
  allowedClientIds: z.array(z.string().min(1)).optional(),
  /**
   * Initial Access Token (RFC 7591 §3). When set, `POST /oauth/register`
   * requires an `Authorization: Bearer <token>` header that matches this value
   * (constant-time compared); requests without it (or with a wrong value) are
   * rejected `401 invalid_token`. When unset, registration is unauthenticated
   * (the historical behavior).
   */
  initialAccessToken: z.string().min(1).optional(),
  /**
   * Pre-registered trusted clients seeded into the registry at startup. These
   * are accepted by the authorize/token flows WITHOUT a DCR round-trip, which
   * lets you disable DCR entirely while still shipping known clients.
   */
  clients: z.array(localDcrClientSchema).optional(),
});

export type LocalDcrConfig = z.infer<typeof localDcrConfigSchema>;
export type LocalDcrConfigInput = z.input<typeof localDcrConfigSchema>;

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
// SECURE STORE CONFIG (#470 — session secure-secret store)
// ============================================

/**
 * How a secure-store namespace is derived from the request:
 * - `user` (default): keyed by the authenticated subject (`sub`).
 * - `session`: keyed by the transport `sessionId`.
 * - `global`: a single server-wide namespace.
 */
export const secureStoreScopeSchema = z.enum(['user', 'session', 'global']);
export type SecureStoreScope = z.infer<typeof secureStoreScopeSchema>;

/**
 * At-rest encryption settings for the BUILT-IN secure-store backings (memory /
 * sqlite / redis). Ignored for a custom `{ backend }` backing (e.g. an OS
 * keychain), which owns its own at-rest protection.
 */
export const secureStoreEncryptionSchema = z.object({
  /**
   * Server pepper mixed into HKDF key derivation (defense-in-depth). Defaults to
   * `VAULT_SECRET ?? JWT_SECRET` at runtime when omitted.
   */
  pepper: z.string().min(1).optional(),
});
export type SecureStoreEncryptionConfig = z.infer<typeof secureStoreEncryptionSchema>;

/**
 * A custom secure-store backing. The framework does NOT bundle any native
 * dependency (keytar/wincred/libsecret); to use an OS keychain (or any other
 * store), supply an object implementing the `SecureStoreBackend` interface here.
 * Validated structurally (`get`/`set`/`delete`/`list` are functions), like the
 * other callback schemas in this file.
 */
export const secureStoreCustomBackendSchema = z.custom<SecureStoreCustomBackend>(
  (v) =>
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { get?: unknown }).get === 'function' &&
    typeof (v as { set?: unknown }).set === 'function' &&
    typeof (v as { delete?: unknown }).delete === 'function' &&
    typeof (v as { list?: unknown }).list === 'function',
  { message: 'secureStore.backend must implement get/set/delete/list (SecureStoreBackend)' },
);

/**
 * Common fields shared by the object-form secure-store configs (everything
 * except the `'memory'` string shorthand): the namespace scope, an optional
 * default TTL, and at-rest encryption settings.
 */
const secureStoreCommonFields = {
  /** Namespace scope. @default 'user' */
  scope: secureStoreScopeSchema.optional(),
  /** Default TTL (ms) for stored secrets. @default undefined (no expiry) */
  ttlMs: z.number().int().positive().optional(),
  /** At-rest encryption settings (built-in backings only). */
  encryption: secureStoreEncryptionSchema.optional(),
};

/**
 * Secure-store configuration (#470). Mirrors the {@link tokenStorageConfigSchema}
 * selection pattern, plus a namespace `scope` and a pluggable custom `backend`:
 *
 * - `'memory'` — in-memory, AES-256-GCM-encrypted (default; lost on restart).
 * - `{ sqlite }` — local SQLite-file persistence (survives restart).
 * - `{ redis }` — Redis-backed persistence.
 * - `{ backend }` — a custom backing implementing `SecureStoreBackend` (e.g. an
 *   OS keychain). The framework bundles NO native dependency for this.
 *
 * The object forms additionally accept `scope`, `ttlMs`, and (for built-ins)
 * `encryption`.
 */
export const secureStoreConfigSchema = z.union([
  z.literal('memory'),
  // Backing-bearing variants MUST precede the bare-object variant: Zod object
  // schemas are non-strict (extra keys allowed), so a bare `z.object({ scope })`
  // would otherwise match `{ sqlite, scope }` first and silently strip the
  // backing. Ordering most-specific-first keeps sqlite/redis/custom intact.
  z.object({ sqlite: tokenStorageSqliteSchema, ...secureStoreCommonFields }),
  z.object({ redis: redisConfigSchema, ...secureStoreCommonFields }),
  z.object({ backend: secureStoreCustomBackendSchema, ...secureStoreCommonFields }),
  z.object({ ...secureStoreCommonFields }),
]);

export type SecureStoreConfig = z.infer<typeof secureStoreConfigSchema>;
export type SecureStoreConfigInput = z.input<typeof secureStoreConfigSchema>;

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
