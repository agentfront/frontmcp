// common/types/options/auth/public.schema.ts
// Public mode - No authentication required

import { z } from 'zod';
import { jsonWebKeySetSchema, jwkSchema } from '../../auth';
import { publicAccessConfigSchema } from './shared.schemas';

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
});

// ============================================
// TYPE EXPORTS
// ============================================

/**
 * Public mode options (output type with defaults applied)
 */
export type PublicAuthOptions = z.infer<typeof publicAuthOptionsSchema>;
export type PublicAuthOptionsInput = z.input<typeof publicAuthOptionsSchema>;
