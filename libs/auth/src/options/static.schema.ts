// options/static.schema.ts
// Static mode — a fixed shared secret presented on every request.

import { z } from '@frontmcp/lazy-zod';

import type { RawZodShape } from '../common/zod-utils';
import type { StaticAuthOptionsInterface } from './interfaces';
import { publicAccessConfigSchema } from './shared.schemas';

// ============================================
// STATIC MODE
// Access token / API key — no OAuth, no JWT, no JWKS
// ============================================

/**
 * Issue #544: every non-OAuth MCP host — ChatGPT's custom-app connector among
 * them — offers an "Access token / API key" option that attaches a fixed
 * `Authorization: Bearer <token>` to every request. FrontMCP had no mode for
 * that shape: `public` is unauthenticated, and `transparent` / `local` /
 * `remote` all assume an issuer to verify against. The practical choice was to
 * expose the server with no auth at all or to stand up a full OAuth 2.1
 * provider for what is one shared secret.
 */
export const staticAuthOptionsSchema = z.object({
  mode: z.literal('static'),

  /**
   * Accepted credentials. Compared against the presented one in constant time,
   * over SHA-256 digests so neither the value nor its length leaks by timing.
   *
   * Read these from the environment — never commit them.
   */
  tokens: z.array(z.string().min(1)).min(1),

  /**
   * Request header carrying the credential.
   * @default 'authorization'
   */
  header: z.string().min(1).default('authorization'),

  /**
   * Scheme prefix to strip before comparing, matched case-insensitively. Set to
   * an empty string for headers that carry a bare token (e.g. `x-api-key`).
   * @default 'Bearer'
   */
  scheme: z.string().default('Bearer'),

  /**
   * Scopes granted to a request that presents a valid token.
   * @default ['static']
   */
  scopes: z.array(z.string()).default(['static']),

  /**
   * Realm reported in the `WWW-Authenticate` challenge on failure.
   * @default 'mcp'
   */
  realm: z.string().default('mcp'),

  /**
   * Tool/prompt access configuration, same shape the other modes accept.
   */
  publicAccess: publicAccessConfigSchema.optional(),
} satisfies RawZodShape<StaticAuthOptionsInterface>);

// ============================================
// TYPE EXPORTS
// ============================================

export type StaticAuthOptions = z.infer<typeof staticAuthOptionsSchema>;
export type StaticAuthOptionsInput = StaticAuthOptionsInterface;
