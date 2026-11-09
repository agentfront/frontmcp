/**
 * @file esm-context-factories.ts
 * @description Factory functions that create context classes for ESM-loaded primitives.
 *
 * Unlike remote-mcp context factories (which proxy to a remote MCP server),
 * these factories create classes that execute code locally in-process.
 * The ESM module's functions are closed over via closure.
 */

import { type Type } from '@frontmcp/di';
import type { CallToolResult, GetPromptResult, ReadResourceResult } from '@frontmcp/protocol';

import { PromptContext, ResourceContext, ToolContext, type ToolInputType, type ToolOutputType } from '../../common';

/**
 * Handler type for ESM tool execution.
 * This is the execute function exported by the ESM package.
 */
/** A plain-object tool's `execute`; `context` is the call's tool context, whose `get()` resolves the package's providers. */
export type EsmToolExecuteHandler = (
  input: Record<string, unknown>,
  context: ToolContext<ToolInputType, ToolOutputType, unknown, CallToolResult>,
) => Promise<CallToolResult>;

/**
 * Handler type for ESM resource reading.
 */
/** A plain-object resource's `read`; `context` is the read's resource context. */
export type EsmResourceReadHandler = (
  uri: string,
  params: Record<string, string>,
  context: ResourceContext,
) => Promise<ReadResourceResult>;

/**
 * Handler type for ESM prompt execution.
 */
/** A plain-object prompt's `execute`; `context` is the request's prompt context. */
export type EsmPromptExecuteHandler = (
  args: Record<string, string>,
  context: PromptContext,
) => Promise<GetPromptResult>;

/**
 * Creates an ESM tool context class that executes locally in-process.
 *
 * The returned class closes over the ESM module's execute function.
 * When called, it runs the tool handler directly in the same Node.js process.
 *
 * @param executeFn - The tool's execute function from the ESM module
 * @param toolName - The name of the tool (for debugging)
 * @returns A ToolContext class that executes the ESM tool locally
 */
export function createEsmToolContextClass(
  executeFn: EsmToolExecuteHandler,
  toolName: string,
): Type<ToolContext<ToolInputType, ToolOutputType, unknown, CallToolResult>> {
  const cls = class DynamicEsmToolContext extends ToolContext<ToolInputType, ToolOutputType, unknown, CallToolResult> {
    async execute(input: unknown): Promise<CallToolResult> {
      return executeFn(input as Record<string, unknown>, this);
    }
  };

  // Set a readable name for debugging
  Object.defineProperty(cls, 'name', { value: `EsmTool_${toolName}` });

  return cls as Type<ToolContext<ToolInputType, ToolOutputType, unknown, CallToolResult>>;
}

/**
 * Creates an ESM resource context class that reads locally in-process.
 *
 * @param readFn - The resource's read function from the ESM module
 * @param resourceName - The name of the resource (for debugging)
 * @returns A ResourceContext class that reads the ESM resource locally
 */
export function createEsmResourceContextClass<Params extends Record<string, string> = Record<string, string>>(
  readFn: EsmResourceReadHandler,
  resourceName: string,
): Type<ResourceContext<Params, ReadResourceResult>> {
  const cls = class DynamicEsmResourceContext extends ResourceContext<Params, ReadResourceResult> {
    async execute(uri: string, params: Params): Promise<ReadResourceResult> {
      return readFn(uri, params, this as unknown as ResourceContext);
    }
  };

  Object.defineProperty(cls, 'name', { value: `EsmResource_${resourceName}` });

  return cls as Type<ResourceContext<Params, ReadResourceResult>>;
}

/**
 * Creates an ESM prompt context class that executes locally in-process.
 *
 * @param executeFn - The prompt's execute function from the ESM module
 * @param promptName - The name of the prompt (for debugging)
 * @returns A PromptContext class that executes the ESM prompt locally
 */
export function createEsmPromptContextClass(
  executeFn: EsmPromptExecuteHandler,
  promptName: string,
): Type<PromptContext> {
  const cls = class DynamicEsmPromptContext extends PromptContext {
    async execute(args: Record<string, string>): Promise<GetPromptResult> {
      return executeFn(args, this);
    }
  };

  Object.defineProperty(cls, 'name', { value: `EsmPrompt_${promptName}` });

  return cls as Type<PromptContext>;
}
