// common/types/options/http/schema.ts
// Zod schema for HTTP configuration

import { z } from 'zod';

/**
 * HTTP options Zod schema.
 */
export const httpOptionsSchema = z.object({
  port: z.number().optional().default(3001),
  entryPath: z.string().default(''),
  hostFactory: z.any().optional(),
});

/**
 * HTTP configuration type (with defaults applied).
 */
export type HttpOptions = z.infer<typeof httpOptionsSchema>;

/**
 * HTTP configuration input type (for user configuration).
 */
export type HttpOptionsInput = z.input<typeof httpOptionsSchema>;
