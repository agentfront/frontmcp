import { z } from 'zod';
import { RawZodShape } from '../types';

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

import {
  ImageContentSchema,
  AudioContentSchema,
  ResourceLinkSchema,
  EmbeddedResourceSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ToolUIConfig } from './tool-ui.metadata';
import { ToolInputOf, ToolOutputOf } from '../decorators';

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
  | z.ZodDiscriminatedUnion<z.ZodObject<any>[]>;

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

  annotations?: ToolAnnotations;

  /**
   * If true, the tool will not be shown in the tool/list action results.
   * this method can still be called directly with tool/call even if hidden.
   * use case: tools that are intended to be private or internal. (usually for testing / private apis)
   * Default: false
   */
  hideFromDiscovery?: boolean;

  /**
   * Optional usage examples for the tool.
   * These are used by codecall:describe to provide accurate usage examples.
   * If provided, these take precedence over auto-generated examples.
   */
  examples?: ToolExample[];

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
    hideFromDiscovery: z.boolean().optional().default(false),
    examples: z.array(toolExampleSchema).optional(),
    ui: z.looseObject({}).optional(),
    authProviders: z.array(toolAuthProviderMappingSchema).optional(),
  } satisfies RawZodShape<ToolMetadata, ExtendFrontMcpToolMetadata>)
  .passthrough();
