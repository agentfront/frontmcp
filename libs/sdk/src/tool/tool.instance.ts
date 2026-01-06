// file: libs/sdk/src/tool/tool.instance.ts

import {
  EntryOwnerRef,
  ToolCallArgs,
  ToolCallExtra,
  ToolContext,
  ToolCtorArgs,
  ToolEntry,
  ToolFunctionTokenRecord,
  ToolInputType,
  ToolKind,
  ToolOutputType,
  ToolRecord,
  ParsedToolResult,
  ToolInputOf,
  ToolOutputOf,
  SafeTransformResult,
} from '../common';
import ProviderRegistry from '../provider/provider.registry';
import { z } from 'zod';
import HookRegistry from '../hooks/hook.registry';
import { Scope } from '../scope';
import { normalizeHooksFromCls } from '../hooks/hooks.utils';
import type { CallToolRequest } from '@modelcontextprotocol/sdk/types.js';
import { buildParsedToolResult } from './tool.utils';
import { InvalidHookFlowError } from '../errors/mcp.error';

/**
 * Concrete implementation of a tool that can be executed.
 *
 * **Scope Binding:** The ToolInstance captures its scope and providers at construction time.
 * All operations (hook registration, tool context creation) use the captured scope.
 * If you need a tool to operate in a different scope (e.g., agent scope), you must
 * create a new ToolInstance with that scope's providers.
 */
export class ToolInstance<
  InSchema extends ToolInputType = ToolInputType,
  OutSchema extends ToolOutputType = ToolOutputType,
  In = ToolInputOf<{ inputSchema: InSchema }>,
  Out = ToolOutputOf<{ outputSchema: OutSchema }>,
> extends ToolEntry<InSchema, OutSchema, In, Out> {
  /** The provider registry this tool is bound to (captured at construction) */
  private readonly providers: ProviderRegistry;
  /** The scope this tool operates in (captured at construction from providers) */
  readonly scope: Scope;
  /** The hook registry for this tool's scope (captured at construction) */
  readonly hooks: HookRegistry;

  constructor(record: ToolRecord, providers: ProviderRegistry, owner: EntryOwnerRef) {
    super(record);
    this.owner = owner;
    this.providers = providers;
    this.name = record.metadata.id || record.metadata.name;
    this.fullName = this.owner.id + ':' + this.name;
    this.scope = this.providers.getActiveScope();
    this.hooks = this.scope.providers.getHooksRegistry();

    const schema: any = record.metadata.inputSchema;
    // Support both Zod objects and raw ZodRawShape
    this.inputSchema = schema instanceof z.ZodObject ? schema.shape : schema ?? {};

    // Whatever JSON schema representation you’re storing for inputs
    this.rawInputSchema = record.metadata.rawInputSchema;

    // IMPORTANT: keep the *raw* outputSchema (string literal, zod, raw shape, or array)
    this.outputSchema = record.metadata.outputSchema as OutSchema;

    this.ready = this.initialize();
  }

  protected async initialize() {
    // Valid flows for tool hooks
    const validFlows = ['tools:call-tool', 'tools:list-tools'];

    const allHooks = normalizeHooksFromCls(this.record.provide);

    // Separate valid and invalid hooks
    const validHooks = allHooks.filter((hook) => validFlows.includes(hook.metadata.flow));
    const invalidHooks = allHooks.filter((hook) => !validFlows.includes(hook.metadata.flow));

    // Throw error for invalid hooks (fail fast)
    if (invalidHooks.length > 0) {
      const className = (this.record.provide as any)?.name ?? 'Unknown';
      const invalidFlowNames = invalidHooks.map((h) => h.metadata.flow).join(', ');
      throw new InvalidHookFlowError(
        `Tool "${className}" has hooks for unsupported flows: ${invalidFlowNames}. ` +
          `Only tool flows (${validFlows.join(', ')}) are supported on tool classes.`,
      );
    }

    // Register valid hooks
    if (validHooks.length > 0) {
      await this.hooks.registerHooks(true, ...validHooks);
    }
    return Promise.resolve();
  }

  getMetadata() {
    return this.record.metadata;
  }

  override getOutputSchema() {
    return this.outputSchema;
  }

  override create(input: ToolCallArgs, ctx: ToolCallExtra): ToolContext<InSchema, OutSchema, In, Out> {
    const metadata = this.metadata;
    const providers = this.providers;
    const scope = this.providers.getActiveScope();
    const logger = scope.logger;
    const authInfo = ctx.authInfo;
    const progressToken = ctx.progressToken;

    const toolCtorArgs: ToolCtorArgs<In> = {
      metadata,
      input: input as In,
      providers,
      logger,
      authInfo,
      progressToken,
    };
    switch (this.record.kind) {
      case ToolKind.CLASS_TOKEN:
        return new this.record.provide(toolCtorArgs) as ToolContext<InSchema, OutSchema, In, Out>;
      case ToolKind.FUNCTION:
        return new FunctionToolContext<InSchema, OutSchema, In, Out>(this.record, toolCtorArgs);
      default:
        // TypeScript exhaustive check - catches deprecated REMOTE or unknown kinds
        throw new Error(`Unhandled tool kind: ${(this.record as { kind: string }).kind}`);
    }
  }

  override parseInput(input: CallToolRequest['params']): CallToolRequest['params']['arguments'] {
    const inputSchema = z.object(this.inputSchema);
    return inputSchema.parse(input.arguments);
  }
  /**
   * Turn the raw tool function result into an MCP-compliant CallToolResult:
   *   - `content`: list of ContentBlocks (text / image / audio / resource / resource_link)
   *   - `structuredContent`: sanitized JSON when outputSchema is "json-like"
   *
   * Rules:
   *   - If outputSchema is a JS array → multiple content items, each with its own type.
   *   - Primitive → stringifies into a TextContent block.
   *   - image/audio/resource/resource_link → passed through as-is.
   *   - JSON / structured → JSON.stringify for text, and full sanitized JSON in structuredContent.
   */
  override parseOutput(raw: Out | Partial<Out> | any): ParsedToolResult {
    const descriptor = this.outputSchema as any;

    return buildParsedToolResult(descriptor, raw);
  }

  override safeParseOutput(raw: Out | Partial<Out> | any): SafeTransformResult<ParsedToolResult> {
    const descriptor = this.outputSchema as any;
    try {
      return { success: true, data: buildParsedToolResult(descriptor, raw) };
    } catch (error: any) {
      return { success: false, error };
    }
  }
}

class FunctionToolContext<
  InSchema extends ToolInputType,
  OutSchema extends ToolOutputType,
  In = ToolInputOf<{ inputSchema: InSchema }>,
  Out = ToolOutputOf<{ outputSchema: OutSchema }>,
> extends ToolContext<InSchema, OutSchema, In, Out> {
  constructor(private readonly record: ToolFunctionTokenRecord, args: ToolCtorArgs<In>) {
    super(args);
  }

  execute(input: In): Promise<Out> {
    return this.record.provide(input, this);
  }
}
