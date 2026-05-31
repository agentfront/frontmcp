// file: libs/sdk/src/common/metadata/output-policy.ts
import { z } from '@frontmcp/lazy-zod';

/**
 * How a tool's output schema is exposed to clients in `tools/list`.
 *
 * Mirrors the OpenAPI adapter's `outputSchema.mode` (`definition` | `description` |
 * `both`) and adds `none` for "don't expose it at all":
 *
 * - `'definition'` (default): advertise it as the tool's `outputSchema` (JSON Schema).
 * - `'description'`: fold a readable rendering of the schema into the tool description
 *   and omit `outputSchema`.
 * - `'both'`: advertise as `outputSchema` AND fold into the description.
 * - `'none'`: do not expose the output schema anywhere.
 *
 * Declarable on `@FrontMcp`, `@App`, and `@Tool`; resolved with a Tool > App > server
 * cascade (see {@link resolveOutputSchemaMode}).
 */
export const OUTPUT_SCHEMA_MODES = ['definition', 'description', 'both', 'none'] as const;
export type OutputSchemaMode = (typeof OUTPUT_SCHEMA_MODES)[number];

/**
 * Rendering used when a schema is folded into a description (`'description'` / `'both'`).
 *
 * - `'summary'` (default): a compact human-readable property list.
 * - `'jsonSchema'`: a fenced JSON Schema code block.
 */
export const SCHEMA_DESCRIPTION_FORMATS = ['summary', 'jsonSchema'] as const;
export type SchemaDescriptionFormat = (typeof SCHEMA_DESCRIPTION_FORMATS)[number];

/** Default exposure mode when unset at every level. */
export const DEFAULT_OUTPUT_SCHEMA_MODE: OutputSchemaMode = 'definition';
/** Default description rendering when unset at every level. */
export const DEFAULT_SCHEMA_DESCRIPTION_FORMAT: SchemaDescriptionFormat = 'summary';

/**
 * Output-validation + output-schema-exposure policy. Declarable on `@FrontMcp`, `@App`,
 * and `@Tool`; the effective value for a tool is resolved Tool > App > server > default.
 */
export interface OutputPolicy {
  /**
   * Allow non-finite numbers (`Infinity` / `-Infinity` / `NaN`) through to JSON
   * serialization (where they become `null`). Default `false` — non-finite numeric
   * output throws `InvalidOutputError`.
   *
   * @default false
   */
  allowNonFinite?: boolean;

  /**
   * How `outputSchema` is exposed in `tools/list`. See {@link OutputSchemaMode}.
   *
   * @default 'definition'
   */
  schemaMode?: OutputSchemaMode;

  /**
   * Rendering when {@link schemaMode} folds the schema into the description.
   *
   * @default 'summary'
   */
  schemaDescriptionFormat?: SchemaDescriptionFormat;
}

/**
 * Zod schema for the `output` policy block, shared by the `@FrontMcp`, `@App`, and
 * `@Tool` metadata schemas so the option stays identical across all three.
 */
export const outputPolicySchema = z.object({
  allowNonFinite: z.boolean().optional(),
  schemaMode: z.enum(OUTPUT_SCHEMA_MODES).optional(),
  schemaDescriptionFormat: z.enum(SCHEMA_DESCRIPTION_FORMATS).optional(),
});

/** Resolve the effective output-schema mode: Tool > App > server > default. */
export function resolveOutputSchemaMode(
  tool?: OutputPolicy,
  app?: OutputPolicy,
  server?: OutputPolicy,
): OutputSchemaMode {
  return tool?.schemaMode ?? app?.schemaMode ?? server?.schemaMode ?? DEFAULT_OUTPUT_SCHEMA_MODE;
}

/** Resolve the effective description rendering: Tool > App > server > default. */
export function resolveSchemaDescriptionFormat(
  tool?: OutputPolicy,
  app?: OutputPolicy,
  server?: OutputPolicy,
): SchemaDescriptionFormat {
  return (
    tool?.schemaDescriptionFormat ??
    app?.schemaDescriptionFormat ??
    server?.schemaDescriptionFormat ??
    DEFAULT_SCHEMA_DESCRIPTION_FORMAT
  );
}

/** Render a JSON Schema's type as a short string (e.g. `string`, `number[]`, `a | b`). */
function schemaTypeOf(schema: Record<string, unknown>): string {
  const type = schema['type'];
  if (Array.isArray(type)) return type.map(String).join(' | ');
  if (type === 'array') {
    const items = schema['items'];
    return `${items && typeof items === 'object' ? schemaTypeOf(items as Record<string, unknown>) : 'any'}[]`;
  }
  if (Array.isArray(schema['enum'])) return (schema['enum'] as unknown[]).map((v) => JSON.stringify(v)).join(' | ');
  if (typeof type === 'string') return type;
  return 'object';
}

/**
 * Render a (top-level object) JSON Schema as a description suffix for the
 * `'description'` / `'both'` modes.
 */
export function formatOutputSchemaForDescription(
  schema: Record<string, unknown>,
  format: SchemaDescriptionFormat,
): string {
  if (format === 'jsonSchema') {
    return `\n\n**Output schema:**\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``;
  }

  const properties = schema['properties'] as Record<string, Record<string, unknown>> | undefined;
  if (!properties || Object.keys(properties).length === 0) {
    return `\n\n**Returns:** \`${schemaTypeOf(schema)}\``;
  }

  const required = new Set(Array.isArray(schema['required']) ? (schema['required'] as string[]) : []);
  const lines = Object.entries(properties).map(([key, prop]) => {
    const desc = typeof prop['description'] === 'string' ? ` — ${prop['description']}` : '';
    return `- \`${key}\`: ${schemaTypeOf(prop)} (${required.has(key) ? 'required' : 'optional'})${desc}`;
  });
  return `\n\n**Returns:**\n${lines.join('\n')}`;
}
