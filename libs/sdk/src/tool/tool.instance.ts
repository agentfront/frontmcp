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
} from '../common';
import ProviderRegistry from '../provider/provider.registry';
import { z } from 'zod';
import HookRegistry from '../hooks/hook.registry';
import { Scope } from '../scope';
import { normalizeHooksFromCls } from '../hooks/hooks.utils';
import type { CallToolRequest } from '@modelcontextprotocol/sdk/types.js';
import { buildParsedToolResult } from './tool.utils';

export class ToolInstance<
  InSchema extends ToolInputType = ToolInputType,
  OutSchema extends ToolOutputType = ToolOutputType,
  In = ToolInputOf<{ inputSchema: InSchema }>,
  Out = ToolOutputOf<{ outputSchema: OutSchema }>,
> extends ToolEntry<InSchema, OutSchema, In, Out> {
  private readonly providers: ProviderRegistry;
  readonly scope: Scope;
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
    this.inputSchema = schema ? schema : {};
    // Whatever JSON schema representation you’re storing for inputs
    this.rawInputSchema = (record.metadata as any).rawInputSchema;

    // IMPORTANT: keep the *raw* outputSchema (string literal, zod, raw shape, or array)
    this.outputSchema = (record.metadata as any).outputSchema;

    this.ready = this.initialize();
  }

  protected async initialize() {
    const hooks = normalizeHooksFromCls(this.record.provide).filter(
      (hook) => hook.metadata.flow === 'tools:call-tool' || hook.metadata.flow === 'tools:list-tools',
    );
    if (hooks.length > 0) {
      await this.hooks.registerHooks(true, ...hooks);
    }
    return Promise.resolve();
  }

  getMetadata() {
    return this.record.metadata;
  }

  /**
   * Expose the raw metadata.outputSchema through the wrapper.
   * This is what you'll later turn into MCP JSON Schema for tools/list.
   */
  override getOutputSchema() {
    return this.outputSchema;
  }

  override create(input: ToolCallArgs, ctx: ToolCallExtra): ToolContext<InSchema, OutSchema, In, Out> {
    const metadata = this.metadata;
    const providers = this.providers;
    const scope = this.providers.getActiveScope();
    const logger = scope.logger;
    const authInfo = ctx.authInfo;

    const toolCtorArgs: ToolCtorArgs<In> = {
      metadata,
      input: input as In,
      providers,
      logger,
      authInfo,
    };
    switch (this.record.kind) {
      case ToolKind.CLASS_TOKEN:
        return new this.record.provide(toolCtorArgs);
      case ToolKind.FUNCTION:
        return new FunctionToolContext<InSchema, OutSchema, In, Out>(this.record, toolCtorArgs);
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

  override safeParseOutput(raw: Out | Partial<Out> | any): z.SafeParseReturnType<Out, ParsedToolResult> {
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
