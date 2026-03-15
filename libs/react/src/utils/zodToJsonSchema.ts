/**
 * zodToJsonSchema — thin centralized wrapper around zod/v4's toJSONSchema.
 *
 * Keeps the zod dependency isolated so the rest of the React SDK only
 * deals with plain JSON Schema objects.
 */

import { toJSONSchema } from 'zod/v4';
import type { z } from 'zod';

export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return toJSONSchema(schema) as Record<string, unknown>;
}
