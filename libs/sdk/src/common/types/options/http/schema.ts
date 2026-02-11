// common/types/options/http/schema.ts
// Zod schema for HTTP configuration

import { z } from 'zod';

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
});

/**
 * HTTP configuration type (with defaults applied).
 */
export type HttpOptions = z.infer<typeof httpOptionsSchema>;

/**
 * HTTP configuration input type (for user configuration).
 */
export type HttpOptionsInput = z.input<typeof httpOptionsSchema>;
