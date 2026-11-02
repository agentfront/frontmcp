// file: libs/sdk/src/common/metadata/output-policy.ts
import { z } from '@frontmcp/lazy-zod';
import { isDevelopment } from '@frontmcp/utils';

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

/**
 * What `tools/call` does with keys an answer carries that its `outputSchema` does not declare.
 *
 * - `'strip'`: drop them.
 * - `'warn'`: drop them and log a warning naming each key once per tool (up to 100 keys per tool).
 * - `'keep'`: send them in `structuredContent` and the text content; `tools/list` then lists the
 *   schema's objects open to undeclared keys.
 * - `'fail'`: refuse the answer with `InvalidOutputError` naming the keys.
 *
 * A call that renders the tool's UI sends declared keys only, whatever the policy, and so does an
 * `outputSchema` with a transform (`.transform()`, `z.preprocess()`, `.pipe()`), whose output cannot
 * be compared with the answer key by key.
 */
export const UNDECLARED_KEYS_POLICIES = ['strip', 'warn', 'keep', 'fail'] as const;
export type UndeclaredKeysPolicy = (typeof UNDECLARED_KEYS_POLICIES)[number];

/**
 * Which end of a list an answer budget keeps when it has to leave items out.
 *
 * - `'keep-newest'` (default): the last items, as in a log or a history kept in time order.
 * - `'keep-oldest'`: the first items.
 */
export const BUDGET_LIST_POLICIES = ['keep-newest', 'keep-oldest'] as const;
export type BudgetListPolicy = (typeof BUDGET_LIST_POLICIES)[number];

/** The smallest `output.budget.maxBytes`: room for an answer's shape and the note on what was left out. */
export const MIN_OUTPUT_BUDGET_BYTES = 1024;

/**
 * The most bytes a tool answer or a resource read may take, measured as UTF-8 JSON. Each copy of
 * the data counts on its own: an answer with both the text and `structuredContent` sends each one
 * within `maxBytes`. The budget never cuts inside JSON: it leaves out whole list items and the end
 * of long strings, and notes what it left out in `_meta['frontmcp/budget']` and a last text line.
 */
export interface OutputBudget {
  /** At least {@link MIN_OUTPUT_BUDGET_BYTES}. */
  maxBytes: number;
  /** @default 'keep-newest' */
  lists?: BudgetListPolicy;
}

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

  /**
   * What `tools/call` does with keys an answer carries that its `outputSchema` does not
   * declare. See {@link UndeclaredKeysPolicy}.
   *
   * @default 'warn' when NODE_ENV is 'development', otherwise 'strip'
   */
  undeclaredKeys?: UndeclaredKeysPolicy;

  /**
   * Fit each answer to a byte budget. `false` turns off a budget an outer level set.
   * See {@link OutputBudget}.
   *
   * @default off
   */
  budget?: OutputBudget | false;
}

/**
 * Zod schema for the `output` policy block, shared by the `@FrontMcp`, `@App`, and
 * `@Tool` metadata schemas so the option stays identical across all three.
 */
export const outputPolicySchema = z.object({
  allowNonFinite: z.boolean().optional(),
  schemaMode: z.enum(OUTPUT_SCHEMA_MODES).optional(),
  schemaDescriptionFormat: z.enum(SCHEMA_DESCRIPTION_FORMATS).optional(),
  undeclaredKeys: z.enum(UNDECLARED_KEYS_POLICIES).optional(),
  budget: z
    .union([
      z.literal(false),
      z
        .object({
          maxBytes: z
            .number()
            .int()
            .min(MIN_OUTPUT_BUDGET_BYTES, {
              message: `output.budget.maxBytes must be an integer of at least ${MIN_OUTPUT_BUDGET_BYTES}`,
            }),
          lists: z.enum(BUDGET_LIST_POLICIES).optional(),
        })
        .strict(),
    ])
    .optional(),
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

/** Resolve the undeclared-keys policy: Tool > App > server > 'warn' in development, 'strip' otherwise. */
export function resolveUndeclaredKeysPolicy(
  tool?: OutputPolicy,
  app?: OutputPolicy,
  server?: OutputPolicy,
): UndeclaredKeysPolicy {
  return tool?.undeclaredKeys ?? app?.undeclaredKeys ?? server?.undeclaredKeys ?? (isDevelopment() ? 'warn' : 'strip');
}

/** Resolve the answer budget: Tool > App > server, where `false` turns off the budget a wider level set. */
export function resolveOutputBudget(
  tool?: OutputPolicy,
  app?: OutputPolicy,
  server?: OutputPolicy,
): OutputBudget | undefined {
  const budget = tool?.budget ?? app?.budget ?? server?.budget;
  return budget === false ? undefined : budget;
}

/** A copy of a JSON Schema whose objects accept undeclared keys: every `additionalProperties: false` is left out. */
export function withUndeclaredKeysAllowed(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(withUndeclaredKeysAllowed);
  if (typeof schema !== 'object' || schema === null) return schema;
  return Object.fromEntries(
    Object.entries(schema)
      .filter(([keyword, value]) => !(keyword === 'additionalProperties' && value === false))
      .map(([keyword, value]) => [keyword, withUndeclaredKeysAllowed(value)]),
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

  const target = resolveLocalRef(schema, schema) ?? schema;
  const lines = propertyLinesOf(target);
  const members = target['anyOf'] ?? target['oneOf'];
  if (!Array.isArray(members)) {
    return lines ? `\n\n**Returns:**\n${lines.join('\n')}` : `\n\n**Returns:** \`${schemaTypeOf(target)}\``;
  }

  const memberLines = members.map((member: Record<string, unknown>) => {
    const resolvedMember = resolveLocalRef(member, schema);
    return resolvedMember ? propertyLinesOf(resolvedMember) : undefined;
  });
  if (memberLines.some((memberLine) => memberLine === undefined)) return '';

  const options = memberLines.map(
    (memberLine, index) => `- Option ${index + 1}:\n${(memberLine ?? []).map((line) => `  ${line}`).join('\n')}`,
  );
  const heading = lines ? `**Returns:**\n${lines.join('\n')}\n\nand one of:` : '**Returns** one of:';
  return `\n\n${heading}\n${options.join('\n')}`;
}

function propertyLinesOf(schema: Record<string, unknown>): string[] | undefined {
  const properties = schema['properties'] as Record<string, Record<string, unknown>> | undefined;
  if (!properties || Object.keys(properties).length === 0) return undefined;

  const required = new Set(Array.isArray(schema['required']) ? (schema['required'] as string[]) : []);
  return Object.entries(properties).map(([key, prop]) => {
    const desc = typeof prop['description'] === 'string' ? ` — ${prop['description']}` : '';
    return `- \`${key}\`: ${schemaTypeOf(prop)} (${required.has(key) ? 'required' : 'optional'})${desc}`;
  });
}

function resolveLocalRef(
  schema: Record<string, unknown>,
  root: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const ref = schema['$ref'];
  if (typeof ref !== 'string') return schema;
  const definitionsPrefix = '#/$defs/';
  if (!ref.startsWith(definitionsPrefix)) return undefined;
  const definitions = root['$defs'] as Record<string, Record<string, unknown>> | undefined;
  return definitions?.[ref.slice(definitionsPrefix.length)];
}
