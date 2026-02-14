// options/shared.schemas.ts
// Shared configuration schemas used across auth modes

import { z } from 'zod';
import { jsonWebKeySetSchema, jwkSchema } from '../common/jwt.types';
import { RedisConfig, redisConfigSchema } from '../session/transport-session.types';

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

export type LocalSigningConfig = z.infer<typeof localSigningConfigSchema>;
export type LocalSigningConfigInput = z.input<typeof localSigningConfigSchema>;

// ============================================
// REMOTE PROVIDER CONFIG
// ============================================

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

export type RemoteProviderConfig = z.infer<typeof remoteProviderConfigSchema>;
export type RemoteProviderConfigInput = z.input<typeof remoteProviderConfigSchema>;

// ============================================
// TOKEN STORAGE CONFIG
// ============================================

/**
 * Token storage configuration for orchestrated mode
 */
export const tokenStorageConfigSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('memory') }),
  z.object({ type: z.literal('redis'), config: redisConfigSchema }),
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
