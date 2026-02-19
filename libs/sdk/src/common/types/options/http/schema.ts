// common/types/options/http/schema.ts
// Zod schema for HTTP configuration

import { z } from 'zod';

/**
 * CORS options Zod schema.
 * Origin accepts boolean, string, string array, or a callback function.
 */
const corsOptionsSchema = z.object({
  origin: z
    .union([z.boolean(), z.string(), z.array(z.string()), z.custom<Function>((val) => typeof val === 'function')])
    .optional(),
  credentials: z.boolean().optional(),
  maxAge: z.number().optional(),
});

/**
 * HTTP options Zod schema.
 */
export const httpOptionsSchema = z.object({
  port: z.number().optional().default(3001),
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
});

/**
 * HTTP configuration type (with defaults applied).
 */
export type HttpOptions = z.infer<typeof httpOptionsSchema>;

/**
 * HTTP configuration input type (for user configuration).
 */
export type HttpOptionsInput = z.input<typeof httpOptionsSchema>;
