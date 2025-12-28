// common/types/options/auth/transparent.schema.ts
// Transparent mode - Pass-through OAuth tokens from remote provider

import { z } from 'zod';
import { publicAccessConfigSchema, remoteProviderConfigSchema } from './shared.schemas';
import { transportConfigSchema } from './transport.deprecated';

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
   * @deprecated Use top-level transport config instead. Kept for backward compatibility.
   */
  transport: transportConfigSchema.optional(),
});

// ============================================
// TYPE EXPORTS
// ============================================

/**
 * Transparent mode options (output type with defaults applied)
 */
export type TransparentAuthOptions = z.infer<typeof transparentAuthOptionsSchema>;
export type TransparentAuthOptionsInput = z.input<typeof transparentAuthOptionsSchema>;
