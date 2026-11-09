/**
 * @file esm-record-builders.ts
 * @description Functions that build standard records for ESM-loaded primitives.
 *
 * Unlike remote-mcp record-builders (which proxy to a remote server), these builders
 * create records for tools/resources/prompts that execute locally in-process.
 */

import type { Type } from '@frontmcp/di';
import { internalZ as z } from '@frontmcp/lazy-zod';
import type { CallToolResult } from '@frontmcp/protocol';

import {
  PromptKind,
  ResourceKind,
  ToolKind,
  type PromptClassTokenRecord,
  type PromptEntry,
  type PromptMetadata,
  type ResourceClassTokenRecord,
  type ResourceEntry,
  type ResourceMetadata,
  type ToolClassTokenRecord,
  type ToolContext,
  type ToolMetadata,
} from '../../common';
import { InvalidInputError } from '../../errors/mcp.error';
import {
  createEsmPromptContextClass,
  createEsmResourceContextClass,
  createEsmToolContextClass,
  type EsmPromptExecuteHandler,
  type EsmResourceReadHandler,
  type EsmToolExecuteHandler,
} from './esm-context-factories';

/**
 * Metadata for an ESM-loaded tool (simplified shape for tools loaded from packages).
 */
export interface EsmToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: unknown;
  execute: EsmToolExecuteHandler;
}

/**
 * Metadata for an ESM-loaded resource.
 */
export interface EsmResourceDefinition {
  name: string;
  description?: string;
  uri: string;
  mimeType?: string;
  read: EsmResourceReadHandler;
}

/**
 * Metadata for an ESM-loaded prompt.
 */
export interface EsmPromptDefinition {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
  execute: EsmPromptExecuteHandler;
}

/**
 * Detect whether a schema object is a Zod raw shape (values are ZodType instances)
 * vs a JSON Schema object (plain data).
 */
function isZodShape(schema: Record<string, unknown>): boolean {
  return Object.values(schema).some((v) => v instanceof z.ZodType);
}

/**
 * Build a ToolClassTokenRecord for an ESM-loaded tool.
 *
 * Detects whether the tool's `inputSchema` is a Zod raw shape or JSON Schema
 * and routes accordingly:
 * - Zod shape → stored in `inputSchema` (converted by `getInputJsonSchema()`)
 * - JSON Schema → stored in `rawInputSchema` (used as-is)
 *
 * @param tool - ESM tool definition with execute function
 * @param namespace - Optional namespace prefix for the tool name
 * @returns Standard ToolClassTokenRecord for use with ToolInstance
 */
export function buildEsmToolRecord(tool: EsmToolDefinition, namespace?: string): ToolClassTokenRecord {
  const toolName = namespace ? `${namespace}:${tool.name}` : tool.name;

  let inputSchema: Record<string, unknown> = {};
  let rawInputSchema: Record<string, unknown> | undefined = undefined;

  if (tool.inputSchema) {
    if (isZodShape(tool.inputSchema)) {
      // Zod raw shape → store in inputSchema field for conversion by getInputJsonSchema()
      inputSchema = tool.inputSchema;
    } else {
      // JSON Schema → store in rawInputSchema (already serialized)
      rawInputSchema = tool.inputSchema;
    }
  }

  const ContextClass = createEsmToolContextClass(esmToolHandler(tool, rawInputSchema), tool.name);

  const metadata: ToolMetadata & Record<string, unknown> = {
    name: toolName,
    id: toolName,
    description: tool.description ?? `ESM tool: ${tool.name}`,
    inputSchema: inputSchema as ToolMetadata['inputSchema'],
    rawInputSchema,
    outputSchema: tool.outputSchema as ToolMetadata['outputSchema'],
    annotations: {
      'frontmcp:esm': true,
      'frontmcp:esmTool': tool.name,
    },
  };

  return {
    kind: ToolKind.CLASS_TOKEN,
    provide: ContextClass as Type<ToolContext>,
    metadata,
  };
}

/**
 * A plain-object tool's `execute`, with the arguments checked against its JSON Schema `inputSchema` first. Without an
 * `outputSchema`, a string, number or boolean answer is sent as its text; an object answer is sent as JSON.
 */
function esmToolHandler(tool: EsmToolDefinition, jsonInputSchema?: Record<string, unknown>): EsmToolExecuteHandler {
  const inputParser = jsonInputSchema && jsonSchemaParserOf(jsonInputSchema);
  return async (input, context) => {
    const parsed = inputParser?.safeParse(input);
    if (parsed && !parsed.success) throw new InvalidInputError('Invalid tool input', parsed.error.issues);
    const answer: unknown = await tool.execute((parsed?.data ?? input) as Record<string, unknown>, context);
    return (tool.outputSchema === undefined ? primitiveAnswerAsText(answer) : answer) as CallToolResult;
  };
}

/** A parser for a JSON Schema, or nothing for a schema Zod cannot read, whose arguments are then not checked. */
function jsonSchemaParserOf(jsonSchema: Record<string, unknown>): z.ZodType | undefined {
  try {
    return z.fromJSONSchema(
      jsonSchema as Parameters<typeof z.fromJSONSchema>[0],
      { defaultTarget: 'draft-2020-12' } as Parameters<typeof z.fromJSONSchema>[1],
    );
  } catch {
    return undefined;
  }
}

function primitiveAnswerAsText(answer: unknown): unknown {
  if (answer === undefined || answer === null) return { content: [] };
  if (typeof answer === 'object') return answer;
  return { content: [{ type: 'text', text: String(answer) }] };
}

/**
 * Build a ResourceClassTokenRecord for an ESM-loaded resource.
 *
 * @param resource - ESM resource definition with read function
 * @param namespace - Optional namespace prefix
 * @returns Standard ResourceClassTokenRecord
 */
export function buildEsmResourceRecord(resource: EsmResourceDefinition, namespace?: string): ResourceClassTokenRecord {
  const resourceName = namespace ? `${namespace}:${resource.name}` : resource.name;

  const ContextClass = createEsmResourceContextClass(resource.read, resource.name);

  const metadata: ResourceMetadata = {
    name: resourceName,
    description: resource.description ?? `ESM resource: ${resource.name}`,
    uri: resource.uri,
    mimeType: resource.mimeType,
  };

  return {
    kind: ResourceKind.CLASS_TOKEN,
    provide: ContextClass as unknown as Type<ResourceEntry>,
    metadata,
  };
}

/**
 * Build a PromptClassTokenRecord for an ESM-loaded prompt.
 *
 * @param prompt - ESM prompt definition with execute function
 * @param namespace - Optional namespace prefix
 * @returns Standard PromptClassTokenRecord
 */
export function buildEsmPromptRecord(prompt: EsmPromptDefinition, namespace?: string): PromptClassTokenRecord {
  const promptName = namespace ? `${namespace}:${prompt.name}` : prompt.name;

  const ContextClass = createEsmPromptContextClass(prompt.execute, prompt.name);

  const metadata: PromptMetadata = {
    name: promptName,
    description: prompt.description ?? `ESM prompt: ${prompt.name}`,
    arguments:
      prompt.arguments?.map((arg) => ({
        name: arg.name,
        description: arg.description,
        required: arg.required,
      })) ?? [],
  };

  return {
    kind: PromptKind.CLASS_TOKEN,
    provide: ContextClass as unknown as Type<PromptEntry>,
    metadata,
  };
}
