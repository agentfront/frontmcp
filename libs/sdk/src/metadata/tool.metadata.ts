import { z } from 'zod';
import { RawZodShape } from '../types';
import { ToolContext } from '../interfaces';
import { ToolHookStage } from '../interfaces/tool-hook.interface';
import type { JSONSchema7 } from 'json-schema';

declare global {
  /**
   * Declarative metadata extends to the an McpTool decorator.
   */
  export interface ExtendFrontMcpToolMetadata {
  }
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


const mcpToolAnnotationsSchema = z.object({
  title: z.string().optional(),
  readOnlyHint: z.boolean().optional(),
  destructiveHint: z.boolean().optional(),
  idempotentHint: z.boolean().optional(),
  openWorldHint: z.boolean().optional(),
} satisfies RawZodShape<ToolAnnotations>).passthrough();


/**
 * Declarative metadata describing what an McpTool contributes.
 */
export interface ToolMetadata<In = z.ZodRawShape, Out = z.ZodRawShape> extends ExtendFrontMcpToolMetadata {
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
  inputSchema: In;
  /**
   * Zod schema describing the expected input payload for the tool.
   * Used for validation and for generating automatic docs/UX.
   */
  rawInputSchema?: JSONSchema7;

  /**
   * Zod schema describing the structure of the tool's successful output.
   */
  outputSchema?: Out;

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


export const frontMcpToolMetadataSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  inputSchema: z.instanceof(Object),
  rawInputSchema: z.any().optional(),
  outputSchema: z.instanceof(Object).optional(),
  tags: z.array(z.string().min(1)).optional(),
  annotations: mcpToolAnnotationsSchema.optional(),
  hideFromDiscovery: z.boolean().optional().default(false),
} satisfies RawZodShape<ToolMetadata, ExtendFrontMcpToolMetadata>).passthrough();


export interface ToolInlineMetadata<In = any, Out = any> extends ToolMetadata<In, Out> {
  execute(input: In, ctx: ToolContext<In, Out>): Promise<Out> | Out;

  hooks?: [ToolHookStage, ((ctx: ToolContext<In, Out>) => Promise<void> | void)][];
}


export const frontMcpToolInlineMetadataSchema = frontMcpToolMetadataSchema.extend({
  execute: z.function().args(z.any(), z.any()).returns(z.promise(z.any()).or(z.any())),
  hooks: z.array(z.tuple([z.nativeEnum(ToolHookStage), z.function().returns(z.promise(z.void()).or(z.void()))])).optional(),
});
