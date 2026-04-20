// common/types/options/http/schema.ts
// Zod schema for HTTP configuration. Uses lazy-zod so the schema tree is
// not constructed at module load when nothing parses it.

import { z } from '@frontmcp/lazy-zod';

import type { RawZodShape } from '../../common.types';
import type { CorsOptions, HttpOptionsInterface } from './interfaces';

type CorsOriginCallback = Extract<CorsOptions['origin'], Function>;

/**
 * CORS options Zod schema.
 * Origin accepts boolean, string, string array, or a callback function.
 */
const corsOptionsSchema = z.object({
  origin: z
    .union([
      z.boolean(),
      z.string(),
      z.array(z.string()),
      z.custom<CorsOriginCallback>((val) => typeof val === 'function'),
    ])
    .optional(),
  credentials: z.boolean().optional(),
  maxAge: z.number().optional(),
});

/**
 * HTTP options Zod schema.
 */
export const httpOptionsSchema = z.object({
  port: z
    .number()
    .optional()
    .default(Number(process.env['PORT']) || 3000),
  entryPath: z.string().default(''),
  // Using z.any() because hostFactory accepts FrontMcpServer | ((config) => FrontMcpServer)
  // which Zod cannot validate at runtime - type safety is enforced via TypeScript interface
  hostFactory: z.any().optional(),
  /**
   * Unix socket path for local-only server mode.
   * When set, the server listens on a Unix socket instead of a TCP port.
   * Express natively supports `app.listen('/path/to/file.sock')`.
   */
  socketPath: z.string().optional(),
  /**
   * CORS configuration.
   * - undefined (default): permissive CORS (all origins, no credentials)
   * - false: CORS disabled
   * - CorsOptions object: custom CORS config
   */
  cors: z.union([z.literal(false), corsOptionsSchema]).optional(),
  /**
   * Security configuration for transport hardening.
   * Opt-in — defaults remain backwards-compatible.
   */
  security: z
    .object({
      strict: z.boolean().optional(),
      bindAddress: z.union([z.literal('loopback'), z.literal('all'), z.string()]).optional(),
      dnsRebindingProtection: z
        .object({
          enabled: z.boolean().optional(),
          allowedHosts: z.array(z.string()).optional(),
          allowedOrigins: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .optional(),
} satisfies RawZodShape<HttpOptionsInterface>);

/**
 * HTTP configuration type (with defaults applied).
 */
export type HttpOptions = z.infer<typeof httpOptionsSchema>;

/**
 * HTTP configuration input type (for user configuration).
 * Uses explicit interface for better IDE autocomplete.
 */
export type HttpOptionsInput = HttpOptionsInterface;
