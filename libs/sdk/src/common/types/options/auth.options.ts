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
// TRANSPORT CONFIG
// Protocol enablement and behavior settings
// ============================================

/**
 * Transport protocol configuration
 * Controls which transport protocols are enabled and their behavior
 */
export const transportConfigSchema = z.object({
  /**
   * Enable legacy SSE transport (old HTTP+SSE protocol)
   * @default false
   */
  enableLegacySSE: z.boolean().default(false),

  /**
   * Enable SSE listener for server-initiated messages (GET /mcp with Accept: text/event-stream)
   * @default true
   */
  enableSseListener: z.boolean().default(true),

  /**
   * Enable streamable HTTP transport (POST with SSE response)
   * @default true
   */
  enableStreamableHttp: z.boolean().default(true),

  /**
   * Enable stateless HTTP mode (requests without session ID)
   * When enabled, allows requests without prior initialize
   * Uses shared singleton transport for anonymous, per-token singleton for authenticated
   * @default false
   */
  enableStatelessHttp: z.boolean().default(false),

  /**
   * Enable stateful HTTP transport (JSON-only responses)
   * @default false
   */
  enableStatefulHttp: z.boolean().default(false),

  /**
   * Require session ID for streamable HTTP (non-stateless mode)
   * When false, streamable HTTP requests don't require prior initialize
   * @default true
   */
  requireSessionForStreamable: z.boolean().default(true),
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
   * Transport protocol configuration
   * Controls which transports are enabled and their behavior
   */
  transport: transportConfigSchema.optional().default({}),
});

// ============================================
// TRANSPARENT MODE
// Pass-through OAuth tokens from remote provider
// ============================================

export const transparentAuthOptionsSchema = z.object({
  mode: z.literal('transparent'),

  /**
   * Remote OAuth provider configuration (required)
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
   * Transport protocol configuration
   * Controls which transports are enabled and their behavior
   */
  transport: transportConfigSchema.optional().default({}),
});

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
   * Transport protocol configuration
   * Controls which transports are enabled and their behavior
   */
  transport: transportConfigSchema.optional().default({}),
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
   * Transport protocol configuration
   * Controls which transports are enabled and their behavior
   */
  transport: transportConfigSchema.optional().default({}),
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
 * Transport protocol configuration
 */
export type TransportConfig = z.infer<typeof transportConfigSchema>;
export type TransportConfigInput = z.input<typeof transportConfigSchema>;

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

export const appAuthOptionsSchema = z.union([
  publicAuthOptionsSchema.extend(standaloneOptionSchema),
  transparentAuthOptionsSchema.extend(standaloneOptionSchema),
  orchestratedLocalSchema.extend(standaloneOptionSchema),
  orchestratedRemoteSchema.extend(standaloneOptionSchema),
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
