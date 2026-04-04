import { z } from 'zod';

/**
 * Zod schema for observability configuration.
 *
 * Permissive — accepts boolean or detailed object for each sub-feature.
 * The actual validation of sink configs, tracing options, etc. is done
 * by @frontmcp/observability at runtime.
 */
export const observabilityOptionsSchema = z
  .union([
    z.boolean(),
    z.object({
      tracing: z.union([z.boolean(), z.looseObject({})]).optional(),
      logging: z.union([z.boolean(), z.looseObject({})]).optional(),
      requestLogs: z.union([z.boolean(), z.looseObject({})]).optional(),
    }),
  ])
  .optional();

export type ObservabilityOptionsInput = z.input<typeof observabilityOptionsSchema>;
