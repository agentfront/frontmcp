/**
 * zodToJsonSchema — thin centralized wrapper around zod/v4's toJSONSchema.
 *
 * Keeps the zod dependency isolated so the rest of the React SDK only
 * deals with plain JSON Schema objects.
 *
 * NOTE: `forceMaterialize` is required before handing a schema to
 * `toJSONSchema`. Zod's converter walks the schema tree via internal
 * `_def` properties and mutates intermediate state; the lazy-zod Proxy
 * intercepts `_def` in a way that breaks those mutations (manifests as
 * `TypeError: Cannot set properties of undefined`). Materializing first
 * gives the converter real zod nodes to work with.
 */

import { forceMaterialize, toJSONSchema, type z } from '@frontmcp/lazy-zod';

export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return toJSONSchema(forceMaterialize(schema)) as Record<string, unknown>;
}
