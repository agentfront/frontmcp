// common/types/options/auth/orchestrated.schema.ts
// Orchestrated mode - Local auth server that can proxy to remote or be fully local

import { z } from 'zod';
import {
  consentConfigSchema,
  incrementalAuthConfigSchema,
  localSigningConfigSchema,
  publicAccessConfigSchema,
  remoteProviderConfigSchema,
  tokenRefreshConfigSchema,
  tokenStorageConfigSchema,
} from './shared.schemas';
import { transportConfigSchema } from './transport.deprecated';

// ============================================
// SHARED ORCHESTRATED FIELDS
// Common fields between local and remote modes
// ============================================

/**
 * Shared fields for orchestrated auth modes (local and remote).
 * Extracted to reduce duplication and ensure consistency.
 */
const orchestratedSharedFields = {
  /**
   * Local signing configuration
   * - For local type: Used for signing tokens
   * - For remote type: Used for issuing local tokens after upstream auth
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
};

// ============================================
// ORCHESTRATED LOCAL MODE
// Full local authentication without external provider
// ============================================

export const orchestratedLocalSchema = z.object({
  mode: z.literal('orchestrated'),
  type: z.literal('local'),
  ...orchestratedSharedFields,
});

// ============================================
// ORCHESTRATED REMOTE MODE
// Local auth server that proxies to remote OAuth provider
// ============================================

export const orchestratedRemoteSchema = z.object({
  mode: z.literal('orchestrated'),
  type: z.literal('remote'),

  /**
   * Remote OAuth provider configuration (required for remote type)
   */
  remote: remoteProviderConfigSchema,

  ...orchestratedSharedFields,
});

// ============================================
// COMBINED ORCHESTRATED SCHEMA
// ============================================

export const orchestratedAuthOptionsSchema = z.discriminatedUnion('type', [
  orchestratedLocalSchema,
  orchestratedRemoteSchema,
]);

// ============================================
// TYPE EXPORTS
// ============================================

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
 * Orchestrated type (local or remote)
 */
export type OrchestratedType = 'local' | 'remote';
