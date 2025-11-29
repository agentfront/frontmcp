import { z } from 'zod';
import { RawZodShape } from '../types';
import type { JSONSchema } from 'zod/v4/core';

/** JSON Schema type from Zod v4 */
type JsonSchema = JSONSchema.JSONSchema;
import {
  ImageContentSchema,
  AudioContentSchema,
  ResourceLinkSchema,
  EmbeddedResourceSchema,
} from '@modelcontextprotocol/sdk/types.js';

declare global {
  /**
   * Declarative metadata extends to the an McpTool decorator.
   */
  interface ExtendFrontMcpToolMetadata {}
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
   * Zod schema describing the expected input payload for the tool.
   * Used for validation and for generating automatic docs/UX.
   */
  rawInputSchema?: JsonSchema;

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
export const frontMcpToolMetadataSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    inputSchema: z.instanceof(Object),
    rawInputSchema: z.any().optional(),
    outputSchema: toolOutputSchema.optional(),
    tags: z.array(z.string().min(1)).optional(),
    annotations: mcpToolAnnotationsSchema.optional(),
    hideFromDiscovery: z.boolean().optional().default(false),
  } satisfies RawZodShape<ToolMetadata, ExtendFrontMcpToolMetadata>)
  .passthrough();
