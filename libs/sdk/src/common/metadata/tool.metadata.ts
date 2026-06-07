import {
  concurrencyConfigSchema,
  rateLimitConfigSchema,
  timeoutConfigSchema,
  type ConcurrencyConfig,
  type RateLimitConfig,
  type TimeoutConfig,
} from '@frontmcp/guard';
import { z } from '@frontmcp/lazy-zod';
import { AudioContentSchema, EmbeddedResourceSchema, ImageContentSchema, ResourceLinkSchema } from '@frontmcp/protocol';
import { entryAvailabilitySchema, type EntryAvailability } from '@frontmcp/utils';

import { type ToolInputOf, type ToolOutputOf } from '../decorators';
import { type RawZodShape } from '../types';
import { outputPolicySchema, type OutputPolicy } from './output-policy';
import { type ToolUIConfig } from './tool-ui.metadata';

// ============================================
// Auth Provider Mapping for Tools
// ============================================

/**
 * Auth provider mapping for tool metadata.
 * Used in @Tool({ authProviders: [...] }) decorator.
 */
export interface ToolAuthProviderMapping {
  /** Provider name */
  name: string;
  /** Whether credential is required (default: true) */
  required?: boolean;
  /** Required scopes for OAuth providers */
  scopes?: string[];
  /** Alias to use when injecting (for multiple providers) */
  alias?: string;
}

/**
 * Auth provider reference - can be a string (provider name) or full mapping
 */
export type ToolAuthProviderRef = string | ToolAuthProviderMapping;

const toolAuthProviderMappingSchema = z.union([
  z.string().min(1),
  z
    .object({
      name: z.string().min(1),
      required: z.boolean().optional().default(true),
      scopes: z.array(z.string()).optional(),
      alias: z.string().optional(),
    })
    .strict(),
]);

/**
 * Auth provider ref with all defaults applied — the shape the call-tool
 * credential gate and PRM scope advertising consume.
 */
export interface NormalizedToolAuthProvider {
  /** Provider name (must match a registered credential provider). */
  name: string;
  /** Whether the credential is required to run the tool (default: true). */
  required: boolean;
  /** Required OAuth scopes (advertised via PRM `scopes_supported`). */
  scopes?: string[];
  /** Local alias used when injecting (defaults to `name`). */
  alias: string;
}

/**
 * Normalize the raw `authProviders` metadata (a mix of string shorthand and
 * `{ name, required?, scopes?, alias? }` objects) into a uniform list with
 * defaults applied:
 *  - string `'github'` → `{ name: 'github', required: true, alias: 'github' }`
 *  - object → `required` defaults to `true`, `alias` defaults to `name`.
 *
 * Centralizes the "default required = true" contract so the call-tool gate and
 * PRM advertising agree on what each ref means. Unknown/invalid entries are
 * skipped defensively (metadata is validated at decoration time, but this is
 * also called against `unknown` metadata in the flow).
 */
export function normalizeToolAuthProviders(refs: unknown): NormalizedToolAuthProvider[] {
  if (!Array.isArray(refs)) return [];
  const out: NormalizedToolAuthProvider[] = [];
  for (const ref of refs) {
    if (typeof ref === 'string') {
      if (ref.length === 0) continue;
      out.push({ name: ref, required: true, alias: ref });
      continue;
    }
    if (typeof ref === 'object' && ref !== null) {
      const obj = ref as Record<string, unknown>;
      const name = obj['name'];
      if (typeof name !== 'string' || name.length === 0) continue;
      const required = typeof obj['required'] === 'boolean' ? (obj['required'] as boolean) : true;
      const scopes = Array.isArray(obj['scopes'])
        ? (obj['scopes'] as unknown[]).filter((s): s is string => typeof s === 'string')
        : undefined;
      const alias = typeof obj['alias'] === 'string' && obj['alias'].length > 0 ? (obj['alias'] as string) : name;
      out.push({ name, required, alias, ...(scopes && scopes.length > 0 ? { scopes } : {}) });
    }
  }
  return out;
}

declare global {
  /**
   * Declarative metadata extends to the an McpTool decorator.
   */
  interface ExtendFrontMcpToolMetadata {}
}

/**
 * Example input/output pair for a tool, used in documentation and describe output.
 */
export interface ToolExample {
  /**
   * Description of what this example demonstrates.
   */
  description: string;

  /**
   * Example input values for the tool.
   */
  input: Record<string, unknown>;

  /**
   * Optional expected output for the example.
   */
  output?: unknown;
}

export interface ToolAnnotations {
  [x: string]: unknown;

  /**
   * A human-readable title for the tool.
   */
  title?: string;
  /**
   * If true, the tool does not modify its environment.
   *
   * Default: false
   */
  readOnlyHint?: boolean;
  /**
   * If true, the tool may perform destructive updates to its environment.
   * If false, the tool performs only additive updates.
   *
   * (This property is meaningful only when `readOnlyHint == false`)
   *
   * Default: true
   */
  destructiveHint?: boolean;
  /**
   * If true, calling the tool repeatedly with the same arguments
   * will have no additional effect on the its environment.
   *
   * (This property is meaningful only when `readOnlyHint == false`)
   *
   * Default: false
   */
  idempotentHint?: boolean;
  /**
   * If true, this tool may interact with an "open world" of external
   * entities. If false, the tool's domain of interaction is closed.
   * For example, the world of a web search tool is open, whereas that
   * of a memory tool is not.
   *
   * Default: true
   */
  openWorldHint?: boolean;
}

const mcpToolAnnotationsSchema = z
  .object({
    title: z.string().optional(),
    readOnlyHint: z.boolean().optional(),
    destructiveHint: z.boolean().optional(),
    idempotentHint: z.boolean().optional(),
    openWorldHint: z.boolean().optional(),
  } satisfies RawZodShape<ToolAnnotations>)
  .passthrough();

/**
 * Tool response type text: include if outputSchema is zod primitive types
 */
type PrimitiveOutputType =
  | 'string'
  | 'number'
  | 'date'
  | 'boolean'
  | z.ZodString
  | z.ZodNumber
  | z.ZodBoolean
  | z.ZodBigInt
  | z.ZodDate;
/**
 * Tool response type image, will use the ImageContentSchema from MCP types
 */
type ImageOutputType = 'image';
export const ImageOutputSchema = ImageContentSchema;
export type ImageOutput = z.output<typeof ImageOutputSchema>;

/**
 * Tool response type audio, will use the AudioContentSchema from MCP types
 */
type AudioOutputType = 'audio';
export const AudioOutputSchema = AudioContentSchema;
export type AudioOutput = z.output<typeof AudioOutputSchema>;

/**
 * Tool response type resource, will use the EmbeddedResourceSchema from MCP types
 */
type ResourceOutputType = 'resource';
export const ResourceOutputSchema = EmbeddedResourceSchema;
export type ResourceOutput = z.output<typeof ResourceOutputSchema>;

/**
 * Tool response type resource_link, will use the ResourceLinkSchema from MCP types
 */
type ResourceLinkOutputType = 'resource_link';
export const ResourceLinkOutputSchema = ResourceLinkSchema;
export type ResourceLinkOutput = z.output<typeof ResourceLinkOutputSchema>;

/**
 * Tool response type json, ZodRawShape for fast usage
 */
type StructuredOutputType =
  | z.ZodRawShape
  | z.ZodObject<any>
  | z.ZodArray<z.ZodType>
  | z.ZodUnion<[z.ZodObject<any>, ...z.ZodObject<any>[]]>
  | z.ZodDiscriminatedUnion<[z.ZodObject<any>, ...z.ZodObject<any>[]]>;

export type ToolSingleOutputType =
  | PrimitiveOutputType
  | ImageOutputType
  | AudioOutputType
  | ResourceOutputType
  | ResourceLinkOutputType
  | StructuredOutputType;

/**
 * Default default tool schema is {}
 */
export type ToolOutputType = ToolSingleOutputType | ToolSingleOutputType[] | undefined;
export type ToolInputType = z.ZodRawShape;

/**
 * Tool visibility states. See `ToolMetadata.visibility` for full semantics.
 *
 * Symmetric with `SkillVisibility` in `skill.metadata.ts`.
 */
export type ToolVisibility = 'public' | 'hidden' | 'internal';

/**
 * Resolve a tool's effective visibility, honoring the deprecated
 * `hideFromDiscovery` alias. Used by the registry and call-tool flow.
 */
export function resolveToolVisibility(metadata: {
  visibility?: ToolVisibility;
  hideFromDiscovery?: boolean;
}): ToolVisibility {
  if (metadata.visibility) return metadata.visibility;
  if (metadata.hideFromDiscovery === true) return 'hidden';
  return 'public';
}

/**
 * Declarative metadata describing what an McpTool contributes.
 */
export interface ToolMetadata<InSchema = ToolInputType, OutSchema extends ToolOutputType = ToolOutputType>
  extends ExtendFrontMcpToolMetadata {
  /**
   * Optional unique identifier for the tool.
   * If omitted, a consumer may derive an ID from the class or file name.
   */
  id?: string;

  /**
   * Human‑readable name of the tool, used in UIs, logs, and discovery.
   */
  name: string;

  /**
   * Short summary describing what the tool does and when to use it.
   */
  description?: string;

  /**
   * Zod schema describing the expected input payload for the tool.
   * Used for validation and for generating automatic docs/UX.
   */
  inputSchema: InSchema;

  /**
   * Zod schema describing the structure of the tool's successful output.
   */
  outputSchema?: OutSchema;

  /**
   * Optional list of tags/labels that categorize the tool for discovery and filtering.
   */
  tags?: string[];

  /**
   * MCP tool annotations (behavioral hints) surfaced in `tools/list` — e.g.
   * `title`, `readOnlyHint`, `destructiveHint`, `idempotentHint`,
   * `openWorldHint`. Advisory only; clients use them for display and safety UX.
   */
  annotations?: ToolAnnotations;

  /**
   * Visibility of this tool to external MCP clients vs internal SDK callers.
   *
   * - `'public'` (default): listed in `tools/list` and callable via `tools/call`.
   * - `'hidden'`: NOT listed in `tools/list`, but still callable via `tools/call`
   *   when the client knows the name (parity with the legacy `hideFromDiscovery`
   *   behavior — used e.g. by `send-elicitation-result.tool.ts`).
   * - `'internal'`: NOT listed AND NOT callable via external `tools/call` —
   *   only invocable from within the SDK via `ExecutionContextBase.callTool(name, args)`.
   *   Other tools, skill actions, agents (when allow-listed), CodeCall scripts,
   *   and jobs can compose with it; an external MCP client request for this tool
   *   is rejected with method-not-found.
   *
   * @default 'public'
   */
  visibility?: ToolVisibility;

  /**
   * @deprecated Use `visibility: 'hidden'` instead. When `visibility` is unset,
   * `hideFromDiscovery: true` is treated as `visibility: 'hidden'` for
   * backwards compatibility. This alias will be removed in a future major.
   */
  hideFromDiscovery?: boolean;

  /**
   * Optional usage examples for the tool.
   * These are used by codecall:describe to provide accurate usage examples.
   * If provided, these take precedence over auto-generated examples.
   */
  examples?: ToolExample[];

  /**
   * Interactive widget UI for this tool's result (MCP-UI / ext-apps).
   *
   * Prefer the file-based form — point at a `.tsx`/`.html` widget file and the
   * build bundles it; the widget's input/output types are inferred from this
   * tool's `inputSchema`/`outputSchema`.
   *
   * @example
   * ```typescript
   * @Tool({ name: 'chart', inputSchema: { points: z.array(z.number()) }, ui: { file: './chart.widget.tsx' } })
   * ```
   */
  ui?: ToolUIConfig<ToolInputOf<InSchema>, ToolOutputOf<OutSchema>>;

  /**
   * Auth providers required by this tool.
   * Credentials will be loaded before tool execution.
   *
   * @example Single provider (shorthand)
   * ```typescript
   * @Tool({ name: 'create-issue', authProviders: ['github'] })
   * ```
   *
   * @example Single provider with options
   * ```typescript
   * @Tool({
   *   name: 'deploy',
   *   authProviders: [{
   *     name: 'github',
   *     required: true,
   *     scopes: ['repo', 'workflow']
   *   }]
   * })
   * ```
   *
   * @example Multiple providers
   * ```typescript
   * @Tool({
   *   name: 'sync-data',
   *   authProviders: ['github', 'jira']
   * })
   * ```
   *
   * @example Multiple providers with options
   * ```typescript
   * @Tool({
   *   name: 'multi-sync',
   *   authProviders: [
   *     { name: 'github', required: true },
   *     { name: 'jira', required: false }
   *   ]
   * })
   * ```
   */
  authProviders?: ToolAuthProviderRef[];

  /**
   * Rate limiting configuration for this tool.
   * Controls how many requests are allowed within a time window.
   *
   * @example
   * ```typescript
   * @Tool({
   *   name: 'search',
   *   inputSchema: { query: z.string() },
   *   rateLimit: { maxRequests: 100, windowMs: 60_000, partitionBy: 'userId' },
   * })
   * ```
   */
  rateLimit?: RateLimitConfig;

  /**
   * Concurrency control configuration for this tool.
   * Limits the number of simultaneous executions.
   *
   * @example
   * ```typescript
   * @Tool({
   *   name: 'deploy',
   *   inputSchema: { env: z.string() },
   *   concurrency: { maxConcurrent: 1 },
   * })
   * ```
   */
  concurrency?: ConcurrencyConfig;

  /**
   * Timeout configuration for this tool's execution.
   * Wraps the execute stage with a deadline.
   *
   * @example
   * ```typescript
   * @Tool({
   *   name: 'long-task',
   *   inputSchema: { query: z.string() },
   *   timeout: { executeMs: 30_000 },
   * })
   * ```
   */
  timeout?: TimeoutConfig;

  /**
   * Environment availability constraint.
   * When set, the tool is only discoverable and executable in matching environments.
   * Fields are AND-ed (all must match), values within a field are OR-ed (any can match).
   * Omitted fields are unconstrained.
   *
   * @example macOS only
   * ```typescript
   * @Tool({ name: 'apple_notes', availableWhen: { platform: ['darwin'] } })
   * ```
   *
   * @example Node.js production only
   * ```typescript
   * @Tool({ name: 'deploy', availableWhen: { runtime: ['node'], env: ['production'] } })
   * ```
   */
  availableWhen?: EntryAvailability;

  /**
   * Execution hints reported in `tools/list` items per MCP 2025-11-25.
   *
   * `taskSupport` controls whether clients may invoke this tool as a background task
   * (see https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks):
   * - `'required'`: clients MUST invoke the tool as a task (the server will reject
   *   non-task-augmented calls with `-32601`).
   * - `'optional'`: clients MAY invoke the tool as a task or as a normal request.
   * - `'forbidden'` or absent (default): clients MUST NOT task-augment the call.
   *
   * @example
   * ```typescript
   * @Tool({ name: 'long_report', execution: { taskSupport: 'optional' } })
   * ```
   */
  execution?: {
    taskSupport?: 'required' | 'optional' | 'forbidden';
  };

  /**
   * Output policy for this tool — overrides `@App` and `@FrontMcp`. Controls
   * non-finite handling (`allowNonFinite`) and how `outputSchema` is exposed in
   * `tools/list` (`schemaMode`: `'definition'` (default) / `'description'` / `'both'` /
   * `'none'`; `schemaDescriptionFormat`: `'summary'` (default) / `'jsonSchema'`).
   */
  output?: OutputPolicy;
}

/**
 * Runtime schema for ToolSingleOutputType:
 *  - literals ('string', 'image', ...)
 *  - any Zod schema (ZodObject, ZodArray, etc.)
 *  - raw shapes (Record<string, ZodTypeAny>)
 */

const primitiveOutputLiteralSchema = z.enum(['string', 'number', 'date', 'boolean']);
const specialOutputLiteralSchema = z.enum(['image', 'audio', 'resource', 'resource_link']);

const outputLiteralSchema = z.union([primitiveOutputLiteralSchema, specialOutputLiteralSchema]);

// Any Zod schema instance (object, array, union, etc.)
const zodSchemaInstanceSchema = z.instanceof(z.ZodType);

// Raw shape: { field: z.string(), ... }
const zodRawShapeSchema = z.record(z.string(), zodSchemaInstanceSchema);

const toolSingleOutputSchema = z.union([outputLiteralSchema, zodSchemaInstanceSchema, zodRawShapeSchema]);

// ToolOutputType = ToolSingleOutputType | ToolSingleOutputType[]
const toolOutputSchema = z.union([toolSingleOutputSchema, z.array(toolSingleOutputSchema)]);
const toolExampleSchema = z.object({
  description: z.string(),
  input: z.record(z.string(), z.unknown()),
  output: z.unknown().optional(),
});

export const frontMcpToolMetadataSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    inputSchema: z.instanceof(Object),
    outputSchema: toolOutputSchema.optional(),
    tags: z.array(z.string().min(1)).optional(),
    annotations: mcpToolAnnotationsSchema.optional(),
    visibility: z.enum(['public', 'hidden', 'internal']).optional(),
    hideFromDiscovery: z.boolean().optional().default(false),
    examples: z.array(toolExampleSchema).optional(),
    ui: z.looseObject({}).optional(),
    authProviders: z.array(toolAuthProviderMappingSchema).optional(),
    rateLimit: rateLimitConfigSchema.optional(),
    concurrency: concurrencyConfigSchema.optional(),
    timeout: timeoutConfigSchema.optional(),
    availableWhen: entryAvailabilitySchema.optional(),
    execution: z
      .object({
        taskSupport: z.enum(['required', 'optional', 'forbidden']).optional(),
      })
      .optional(),
    output: outputPolicySchema.optional(),
  } satisfies RawZodShape<ToolMetadata, ExtendFrontMcpToolMetadata>)
  .passthrough();
