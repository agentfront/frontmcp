// options/public.schema.ts
// Public mode - No authentication required

import { internalZ as z } from '@frontmcp/lazy-zod';

import { jsonWebKeySetSchema, jwkSchema } from '../common/jwt.types';
import type { RawZodShape } from '../common/zod-utils';
import type { PublicAuthOptionsInterface } from './interfaces';
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
  sessionTtl: z.number().int().positive().default(3600),

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
   * Public keys published at `/.well-known/jwks.json` beside the `signKey`'s, and accepted on verification
   * (e.g. a retired key's, while its tokens expire). Needs an RSA, EC or Ed25519 `signKey`.
   * @default the `signKey`'s public key only
   */
  jwks: jsonWebKeySetSchema.optional(),

  /**
   * Private key to sign tokens with, in place of `JWT_SECRET` (HS256).
   * An RSA, EC or Ed25519 private JWK signs with its `alg` (default by key type) and is published at
   * `/.well-known/jwks.json`; a `Uint8Array` or `oct` JWK is an HMAC key and is never published.
   * @default HS256 with `JWT_SECRET`
   */
  signKey: jwkSchema.or(z.instanceof(Uint8Array)).optional(),
} satisfies RawZodShape<PublicAuthOptionsInterface>);

// ============================================
// TYPE EXPORTS
// ============================================

export type PublicAuthOptions = z.infer<typeof publicAuthOptionsSchema>;
export type PublicAuthOptionsInput = PublicAuthOptionsInterface;
