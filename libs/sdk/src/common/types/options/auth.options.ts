// common/types/options/auth.options.ts

import { z } from 'zod';
import { JSONWebKeySet, jsonWebKeySetSchema, JWK, jwkSchema } from '../auth';
import { RawZodShape } from '../common.types';
import { RedisConfig, redisConfigSchema } from '../../../auth/session/transport-session.types';

// ============================================
// SHARED SCHEMAS
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

/**
 * Local signing configuration (for orchestrated local type)
 */
export const localSigningConfigSchema = z.object({
  /**
   * Private key for signing orchestrated tokens
   * @default auto-generated
   */
  signKey: jwkSchema.or(z.instanceof(Uint8Array)).optional(),

  /**
   * JWKS for token verification
   * @default auto-generated
   */
  jwks: jsonWebKeySetSchema.optional(),

  /**
   * Issuer identifier for orchestrated tokens
   * @default auto-derived from server URL
   */
  issuer: z.string().optional(),
});

/**
 * Remote OAuth provider configuration (for orchestrated remote and transparent)
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
   * Client ID for this MCP server (for orchestrated mode)
   */
  clientId: z.string().optional(),

  /**
   * Client secret (for confidential clients in orchestrated mode)
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

/**
 * Advanced remote provider options (for flat transparent config)
 * Contains less commonly used settings that can be nested under 'advanced'
 */
export const advancedRemoteOptionsSchema = z.object({
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
   */
  jwks: jsonWebKeySetSchema.optional(),

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

export type AdvancedRemoteOptions = z.infer<typeof advancedRemoteOptionsSchema>;

/**
 * Token storage configuration for orchestrated mode
 */
export const tokenStorageConfigSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('memory') }),
  z.object({ type: z.literal('redis'), config: redisConfigSchema }),
]);

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

/**
 * Behavior when a tool from a skipped (not yet authorized) app is called
 */
export const skippedAppBehaviorSchema = z.enum(['anonymous', 'require-auth']);

/**
 * Consent configuration for tool selection
 * Allows users to choose which MCP tools to expose to the LLM
 *
 * Note: This schema is the canonical definition. It is duplicated in
 * auth/consent/consent.types.ts for domain-specific use. Both schemas
 * MUST be kept in sync. The duplication exists to avoid circular
 * dependencies between common/ and auth/ modules.
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

// ============================================
// TRANSPORT CONFIG (DEPRECATED)
// These schemas are kept for backward compatibility during migration.
// Use top-level transport config instead.
// DELETE after v1.0.0
// ============================================

/**
 * @deprecated Use top-level transport config instead. This will be removed in v1.0.0.
 */
export const transportRecreationConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    redis: redisConfigSchema.optional(),
    defaultTtlMs: z.number().int().positive().default(3600000),
  })
  .refine(
    (data) => {
      if (data.enabled && !data.redis) {
        return false;
      }
      return true;
    },
    {
      message: 'Redis configuration is required when transport recreation is enabled',
      path: ['redis'],
    },
  );

/**
 * @deprecated Use top-level transport config instead. This will be removed in v1.0.0.
 */
export const transportConfigSchema = z.object({
  enableLegacySSE: z.boolean().default(false),
  enableSseListener: z.boolean().default(true),
  enableStreamableHttp: z.boolean().default(true),
  enableStatelessHttp: z.boolean().default(false),
  enableStatefulHttp: z.boolean().default(false),
  requireSessionForStreamable: z.boolean().default(true),
  recreation: z.lazy(() => transportRecreationConfigSchema).optional(),
});

// ============================================
// PUBLIC MODE
// No authentication required, anonymous access
// ============================================

export const publicAuthOptionsSchema = z.object({
  mode: z.literal('public'),

  /**
   * Issuer identifier for anonymous JWTs
   * @default auto-derived from server URL
   */
  issuer: z.string().optional(),

  /**
   * Anonymous session TTL in seconds
   * @default 3600 (1 hour)
   */
  sessionTtl: z.number().default(3600),

  /**
   * Scopes granted to anonymous sessions
   * @default ['anonymous']
   */
  anonymousScopes: z.array(z.string()).default(['anonymous']),

  /**
   * Tool/prompt access configuration for anonymous users
   */
  publicAccess: publicAccessConfigSchema.optional(),

  /**
   * JWKS for token verification
   * @default auto-generated
   */
  jwks: jsonWebKeySetSchema.optional(),

  /**
   * Private key for signing anonymous tokens
   * @default auto-generated
   */
  signKey: jwkSchema.or(z.instanceof(Uint8Array)).optional(),

  /**
   * @deprecated Use top-level transport config instead. Kept for backward compatibility.
   */
  transport: transportConfigSchema.optional(),
});

// ============================================
// TRANSPARENT MODE
// Pass-through OAuth tokens from remote provider
// ============================================

/**
 * Internal canonical transparent schema (always has remote)
 * This is the normalized output format used internally
 */
const transparentAuthCanonicalSchema = z.object({
  mode: z.literal('transparent'),

  /**
   * Remote OAuth provider configuration (required in canonical form)
   */
  remote: remoteProviderConfigSchema,

  /**
   * Expected token audience
   * If not set, defaults to the resource URL
   */
  expectedAudience: z.union([z.string(), z.array(z.string())]).optional(),

  /**
   * Required scopes for access
   * Empty array means any valid token is accepted
   * @default []
   */
  requiredScopes: z.array(z.string()).default([]),

  /**
   * Allow anonymous fallback when no token is provided
   * @default false
   */
  allowAnonymous: z.boolean().default(false),

  /**
   * Scopes granted to anonymous sessions (when allowAnonymous=true)
   * @default ['anonymous']
   */
  anonymousScopes: z.array(z.string()).default(['anonymous']),

  /**
   * Public access config for anonymous users (when allowAnonymous=true)
   */
  publicAccess: publicAccessConfigSchema.optional(),

  /**
   * @deprecated Use top-level transport config instead. Kept for backward compatibility.
   */
  transport: transportConfigSchema.optional(),
});

/**
 * Transparent auth input schema - accepts flat or legacy nested config
 *
 * Supports two input formats:
 * 1. Flat: { provider, clientId, clientSecret, jwksUri, ... }
 * 2. Legacy nested: { remote: { provider, ... }, ... }
 */
const transparentAuthInputSchema = z.object({
  mode: z.literal('transparent'),

  // ---- Flat provider fields ----
  /**
   * OAuth provider base URL
   * @example 'https://auth.example.com'
   */
  provider: z.string().url().optional(),

  /**
   * Client ID for this MCP server
   */
  clientId: z.string().optional(),

  /**
   * Client secret for confidential clients
   */
  clientSecret: z.string().optional(),

  /**
   * Custom JWKS URI
   */
  jwksUri: z.string().url().optional(),

  // ---- Advanced options ----
  /**
   * Advanced remote provider options
   * Use for less common settings like scopes, DCR, endpoint overrides
   */
  advanced: advancedRemoteOptionsSchema.optional(),

  // ---- Legacy nested config (backward compat) ----
  /**
   * Legacy nested remote configuration
   * @deprecated Use flat fields (provider, clientId, etc.) instead
   */
  remote: remoteProviderConfigSchema.optional(),

  // ---- Existing top-level fields ----
  /**
   * Expected token audience
   * If not set, defaults to the resource URL
   */
  expectedAudience: z.union([z.string(), z.array(z.string())]).optional(),

  /**
   * Required scopes for access
   * Empty array means any valid token is accepted
   * @default []
   */
  requiredScopes: z.array(z.string()).default([]),

  /**
   * Allow anonymous fallback when no token is provided
   * @default false
   */
  allowAnonymous: z.boolean().default(false),

  /**
   * Scopes granted to anonymous sessions (when allowAnonymous=true)
   * @default ['anonymous']
   */
  anonymousScopes: z.array(z.string()).default(['anonymous']),

  /**
   * Public access config for anonymous users (when allowAnonymous=true)
   */
  publicAccess: publicAccessConfigSchema.optional(),

  /**
   * @deprecated Use top-level transport config instead. Kept for backward compatibility.
   */
  transport: transportConfigSchema.optional(),
});

type TransparentAuthInputRaw = z.infer<typeof transparentAuthInputSchema>;
type TransparentAuthCanonical = z.infer<typeof transparentAuthCanonicalSchema>;

/**
 * Normalize transparent auth input to canonical internal format
 * Handles: flat config and legacy nested config
 */
function normalizeTransparentAuthInput(input: TransparentAuthInputRaw): TransparentAuthCanonical {
  // Already has remote (legacy) - pass through with merge of any flat fields
  if (input.remote) {
    const mergedRemote = {
      ...input.remote,
      // Flat fields override if provided (for migration scenarios)
      ...(input.clientId && { clientId: input.clientId }),
      ...(input.clientSecret && { clientSecret: input.clientSecret }),
      ...(input.jwksUri && { jwksUri: input.jwksUri }),
      // Merge advanced options
      ...input.advanced,
    };

    return {
      mode: 'transparent',
      remote: mergedRemote,
      expectedAudience: input.expectedAudience,
      requiredScopes: input.requiredScopes,
      allowAnonymous: input.allowAnonymous,
      anonymousScopes: input.anonymousScopes,
      publicAccess: input.publicAccess,
      transport: input.transport,
    };
  }

  if (!input.provider) {
    throw new Error('Either provider or remote is required for transparent auth');
  }

  // Build remote config from flat fields + advanced options
  const remote: RemoteProviderConfig = {
    provider: input.provider,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    jwksUri: input.jwksUri,
    dcrEnabled: input.advanced?.dcrEnabled ?? false,
    ...input.advanced,
  };

  return {
    mode: 'transparent',
    remote,
    expectedAudience: input.expectedAudience,
    requiredScopes: input.requiredScopes,
    allowAnonymous: input.allowAnonymous,
    anonymousScopes: input.anonymousScopes,
    publicAccess: input.publicAccess,
    transport: input.transport,
  };
}

/**
 * Transparent mode authentication options
 *
 * Supports two input formats for easy configuration:
 *
 * @example Flat config (recommended)
 * ```typescript
 * {
 *   mode: 'transparent',
 *   provider: 'https://auth.example.com',
 *   clientId: 'my-client-id',
 *   expectedAudience: 'my-api',
 * }
 * ```
 *
 * @example Legacy nested config (backward compatible)
 * ```typescript
 * {
 *   mode: 'transparent',
 *   remote: { provider: 'https://auth.example.com', clientId: '...' },
 * }
 * ```
 */
export const transparentAuthOptionsSchema = transparentAuthInputSchema
  .refine((data) => data.remote || data.provider, {
    message: 'Must specify provider or remote configuration',
  })
  .transform(normalizeTransparentAuthInput);

// ============================================
// ORCHESTRATED MODE
// Local auth server that can proxy to remote or be fully local
// ============================================

/**
 * Orchestrated mode with local authentication only
 */
export const orchestratedLocalSchema = z.object({
  mode: z.literal('orchestrated'),
  type: z.literal('local'),

  /**
   * Local signing configuration
   */
  local: localSigningConfigSchema.optional(),

  /**
   * Token storage configuration
   * @default { type: 'memory' }
   */
  tokenStorage: tokenStorageConfigSchema.default({ type: 'memory' }),

  /**
   * Session storage mode
   * - 'stateful': Store sessions in Redis/memory, JWT contains only reference
   * - 'stateless': All state encrypted in JWT
   * @default 'stateful'
   */
  sessionMode: z.enum(['stateful', 'stateless']).default('stateful'),

  /**
   * Allow default public access for unauthenticated requests
   * When true: all tools are public by default, only tools marked with scopes require auth
   * When false: all tools require authentication by default
   * @default false
   */
  allowDefaultPublic: z.boolean().default(false),

  /**
   * Scopes granted to anonymous sessions (when allowDefaultPublic=true)
   * @default ['anonymous']
   */
  anonymousScopes: z.array(z.string()).default(['anonymous']),

  /**
   * Public access config (when allowDefaultPublic=true)
   */
  publicAccess: publicAccessConfigSchema.optional(),

  /**
   * Consent flow configuration for tool selection
   * Allows users to choose which MCP tools to expose to the LLM
   * @default { enabled: false }
   */
  consent: consentConfigSchema.optional(),

  /**
   * Token refresh settings
   */
  refresh: tokenRefreshConfigSchema.optional(),

  /**
   * Expected token audience for validation
   */
  expectedAudience: z.union([z.string(), z.array(z.string())]).optional(),

  /**
   * Incremental (progressive) authorization configuration
   * Allows users to skip app authorizations initially and authorize later
   * @default { enabled: true, skippedAppBehavior: 'anonymous' }
   */
  incrementalAuth: incrementalAuthConfigSchema.optional(),

  /**
   * @deprecated Use top-level transport config instead. Kept for backward compatibility.
   */
  transport: transportConfigSchema.optional(),
});

/**
 * Orchestrated mode with remote OAuth provider
 */
export const orchestratedRemoteSchema = z.object({
  mode: z.literal('orchestrated'),
  type: z.literal('remote'),

  /**
   * Remote OAuth provider configuration (required for remote type)
   */
  remote: remoteProviderConfigSchema,

  /**
   * Local signing configuration (for issuing local tokens after upstream auth)
   */
  local: localSigningConfigSchema.optional(),

  /**
   * Token storage configuration
   * @default { type: 'memory' }
   */
  tokenStorage: tokenStorageConfigSchema.default({ type: 'memory' }),

  /**
   * Session storage mode
   * - 'stateful': Store sessions in Redis/memory, JWT contains only reference
   * - 'stateless': All state encrypted in JWT
   * @default 'stateful'
   */
  sessionMode: z.enum(['stateful', 'stateless']).default('stateful'),

  /**
   * Allow default public access for unauthenticated requests
   * When true: all tools are public by default, only tools marked with scopes require auth
   * When false: all tools require authentication by default
   * @default false
   */
  allowDefaultPublic: z.boolean().default(false),

  /**
   * Scopes granted to anonymous sessions (when allowDefaultPublic=true)
   * @default ['anonymous']
   */
  anonymousScopes: z.array(z.string()).default(['anonymous']),

  /**
   * Public access config (when allowDefaultPublic=true)
   */
  publicAccess: publicAccessConfigSchema.optional(),

  /**
   * Consent flow configuration for tool selection
   * Allows users to choose which MCP tools to expose to the LLM
   * @default { enabled: false }
   */
  consent: consentConfigSchema.optional(),

  /**
   * Token refresh settings
   */
  refresh: tokenRefreshConfigSchema.optional(),

  /**
   * Expected token audience for validation
   */
  expectedAudience: z.union([z.string(), z.array(z.string())]).optional(),

  /**
   * Incremental (progressive) authorization configuration
   * Allows users to skip app authorizations initially and authorize later
   * @default { enabled: true, skippedAppBehavior: 'anonymous' }
   */
  incrementalAuth: incrementalAuthConfigSchema.optional(),

  /**
   * @deprecated Use top-level transport config instead. Kept for backward compatibility.
   */
  transport: transportConfigSchema.optional(),
});

// Combined orchestrated schema
export const orchestratedAuthOptionsSchema = z.discriminatedUnion('type', [
  orchestratedLocalSchema,
  orchestratedRemoteSchema,
]);

// ============================================
// UNIFIED AUTH OPTIONS
// ============================================

/**
 * Main auth options schema - discriminated by 'mode'
 *
 * Uses z.union because we have nested discriminators (orchestrated has 'type')
 */
export const authOptionsSchema = z.union([
  publicAuthOptionsSchema,
  transparentAuthOptionsSchema,
  orchestratedLocalSchema,
  orchestratedRemoteSchema,
]);

// ============================================
// TYPE EXPORTS
// ============================================

/**
 * Public access configuration
 */
export type PublicAccessConfig = z.infer<typeof publicAccessConfigSchema>;
export type PublicAccessConfigInput = z.input<typeof publicAccessConfigSchema>;

/**
 * Local signing configuration
 */
export type LocalSigningConfig = z.infer<typeof localSigningConfigSchema>;
export type LocalSigningConfigInput = z.input<typeof localSigningConfigSchema>;

/**
 * Remote provider configuration
 */
export type RemoteProviderConfig = z.infer<typeof remoteProviderConfigSchema>;
export type RemoteProviderConfigInput = z.input<typeof remoteProviderConfigSchema>;

/**
 * Token storage configuration
 */
export type TokenStorageConfig = z.infer<typeof tokenStorageConfigSchema>;
export type TokenStorageConfigInput = z.input<typeof tokenStorageConfigSchema>;

/**
 * Token refresh configuration
 */
export type TokenRefreshConfig = z.infer<typeof tokenRefreshConfigSchema>;
export type TokenRefreshConfigInput = z.input<typeof tokenRefreshConfigSchema>;

/**
 * Incremental (progressive) authorization configuration
 */
export type IncrementalAuthConfig = z.infer<typeof incrementalAuthConfigSchema>;
export type IncrementalAuthConfigInput = z.input<typeof incrementalAuthConfigSchema>;

/**
 * Skipped app behavior type
 */
export type SkippedAppBehavior = z.infer<typeof skippedAppBehaviorSchema>;

/**
 * Consent configuration for tool selection
 */
export type ConsentConfig = z.infer<typeof consentConfigSchema>;
export type ConsentConfigInput = z.input<typeof consentConfigSchema>;

/**
 * @deprecated Use TransportOptions from transport.options.ts instead
 */
export type TransportConfig = z.infer<typeof transportConfigSchema>;
/**
 * @deprecated Use TransportOptionsInput from transport.options.ts instead
 */
export type TransportConfigInput = z.input<typeof transportConfigSchema>;

/**
 * @deprecated Use TransportPersistenceConfig from transport.options.ts instead
 */
export type TransportRecreationConfig = z.infer<typeof transportRecreationConfigSchema>;
/**
 * @deprecated Use TransportPersistenceConfigInput from transport.options.ts instead
 */
export type TransportRecreationConfigInput = z.input<typeof transportRecreationConfigSchema>;

/**
 * Public mode options (output type with defaults applied)
 */
export type PublicAuthOptions = z.infer<typeof publicAuthOptionsSchema>;
export type PublicAuthOptionsInput = z.input<typeof publicAuthOptionsSchema>;

/**
 * Transparent mode options (output type with defaults applied)
 */
export type TransparentAuthOptions = z.infer<typeof transparentAuthOptionsSchema>;
export type TransparentAuthOptionsInput = z.input<typeof transparentAuthOptionsSchema>;

/**
 * Orchestrated local mode options
 */
export type OrchestratedLocalOptions = z.infer<typeof orchestratedLocalSchema>;
export type OrchestratedLocalOptionsInput = z.input<typeof orchestratedLocalSchema>;

/**
 * Orchestrated remote mode options
 */
export type OrchestratedRemoteOptions = z.infer<typeof orchestratedRemoteSchema>;
export type OrchestratedRemoteOptionsInput = z.input<typeof orchestratedRemoteSchema>;

/**
 * Orchestrated mode options (union of local and remote)
 */
export type OrchestratedAuthOptions = z.infer<typeof orchestratedAuthOptionsSchema>;
export type OrchestratedAuthOptionsInput = z.input<typeof orchestratedAuthOptionsSchema>;

/**
 * Auth options (output type with defaults applied)
 * Use this type when working with parsed/validated options
 */
export type AuthOptions = z.infer<typeof authOptionsSchema>;

/**
 * Auth options input (input type for user configuration)
 * Use this type for the @frontmcp configuration
 */
export type AuthOptionsInput = z.input<typeof authOptionsSchema>;

/**
 * Authentication mode
 */
export type AuthMode = 'public' | 'transparent' | 'orchestrated';

/**
 * Orchestrated type (local or remote)
 */
export type OrchestratedType = 'local' | 'remote';

// ============================================
// APP-LEVEL AUTH OPTIONS (with standalone)
// ============================================

type StandaloneOption = {
  /**
   * If the provider is standalone, it will register an OAuth service provider
   * on app's entry path. If not standalone, it will be registered as a child
   * provider under the root provider.
   * @default false
   */
  standalone?: boolean;

  /**
   * If the provider should be excluded from the parent provider's discovery.
   * Used for standalone providers.
   * @default false
   */
  excludeFromParent?: boolean;
};

const standaloneOptionSchema = {
  standalone: z.boolean().optional(),
  excludeFromParent: z.boolean().optional(),
} satisfies RawZodShape<StandaloneOption>;

/**
 * App-level transparent auth input with standalone option
 * Uses the input schema (before transform) to allow .extend()
 */
const appTransparentAuthInputSchema = transparentAuthInputSchema
  .extend(standaloneOptionSchema)
  .refine((data) => data.remote || data.provider, {
    message: 'Must specify provider or remote configuration',
  })
  .transform((input) => {
    const normalized = normalizeTransparentAuthInput(input);
    return {
      ...normalized,
      standalone: input.standalone,
      excludeFromParent: input.excludeFromParent,
    };
  });

export const orchestratedSchema = z.discriminatedUnion('type', [
  orchestratedLocalSchema.extend(standaloneOptionSchema),
  orchestratedRemoteSchema.extend(standaloneOptionSchema),
]);

export const appAuthOptionsSchema = z.discriminatedUnion('mode', [
  publicAuthOptionsSchema.extend(standaloneOptionSchema),
  appTransparentAuthInputSchema,
  orchestratedSchema,
]);

export type AppAuthOptions = z.infer<typeof appAuthOptionsSchema>;
export type AppAuthOptionsInput = z.input<typeof appAuthOptionsSchema>;

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Parse and validate auth options with defaults
 */
export function parseAuthOptions(input: AuthOptionsInput): AuthOptions {
  return authOptionsSchema.parse(input);
}

/**
 * Check if options are public mode
 */
export function isPublicMode(options: AuthOptions | AuthOptionsInput): options is PublicAuthOptions {
  return options.mode === 'public';
}

/**
 * Check if options are transparent mode
 */
export function isTransparentMode(options: AuthOptions | AuthOptionsInput): options is TransparentAuthOptions {
  return options.mode === 'transparent';
}

/**
 * Check if options are orchestrated mode
 */
export function isOrchestratedMode(options: AuthOptions | AuthOptionsInput): options is OrchestratedAuthOptions {
  return options.mode === 'orchestrated';
}

/**
 * Check if orchestrated options are local type
 */
export function isOrchestratedLocal(options: OrchestratedAuthOptions): options is OrchestratedLocalOptions {
  return options.type === 'local';
}

/**
 * Check if orchestrated options are remote type
 */
export function isOrchestratedRemote(options: OrchestratedAuthOptions): options is OrchestratedRemoteOptions {
  return options.type === 'remote';
}

/**
 * Check if options allow public/anonymous access
 */
export function allowsPublicAccess(options: AuthOptions): boolean {
  if (options.mode === 'public') return true;
  if (options.mode === 'transparent') return options.allowAnonymous;
  if (options.mode === 'orchestrated') return options.allowDefaultPublic;
  return false;
}
