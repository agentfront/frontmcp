// file: libs/sdk/src/tool/tool.instance.ts

import { z } from '@frontmcp/lazy-zod';
import type { CallToolRequest } from '@frontmcp/protocol';

import {
  ToolContext,
  ToolEntry,
  ToolKind,
  type EntryOwnerRef,
  type ParsedToolResult,
  type SafeTransformResult,
  type ScopeEntry,
  type ToolCallArgs,
  type ToolCallExtra,
  type ToolCtorArgs,
  type ToolFunctionTokenRecord,
  type ToolInputOf,
  type ToolInputType,
  type ToolOutputOf,
  type ToolOutputType,
  type ToolRecord,
} from '../common';
import { extendOutputSchemaForElicitation } from '../elicitation/helpers';
import { InvalidRegistryKindError } from '../errors';
import { InvalidHookFlowError } from '../errors/mcp.error';
import type HookRegistry from '../hooks/hook.registry';
import { normalizeHooksFromCls } from '../hooks/hooks.utils';
import type ProviderRegistry from '../provider/provider.registry';
import { buildParsedToolResult } from './tool.utils';

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
  private readonly _providers: ProviderRegistry;
  /** The scope this tool operates in (captured at construction from providers) */
  readonly scope: ScopeEntry;
  /** The hook registry for this tool's scope (captured at construction) */
  readonly hooks: HookRegistry;

  constructor(record: ToolRecord, providers: ProviderRegistry, owner: EntryOwnerRef) {
    super(record);
    this.owner = owner;
    this._providers = providers;
    this.name = record.metadata.id || record.metadata.name;
    this.fullName = this.owner.id + ':' + this.name;
    this.scope = this._providers.getActiveScope();
    this.hooks = this.scope.hooks;

    // inputSchema is always a ZodRawShape
    this.inputSchema = (record.metadata.inputSchema ?? {}) as InSchema;

    // @internal: rawInputSchema is set by OpenAPI adapter via passthrough, not user-facing
    const meta = record.metadata as unknown as Record<string, unknown>;
    this.rawInputSchema = meta['rawInputSchema'];

    // IMPORTANT: keep the *raw* outputSchema (string literal, zod, raw shape, or array)
    this.outputSchema = record.metadata.outputSchema as OutSchema;

    // @internal: rawOutputSchema is set by OpenAPI adapter via passthrough, not user-facing
    this.rawOutputSchema = meta['rawOutputSchema'];

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

  /**
   * Get the raw JSON Schema for output, optionally extended with elicitation fallback type.
   *
   * When elicitation is enabled in scope configuration, the output schema is
   * automatically wrapped in a oneOf union to allow either the original output
   * OR an elicitation pending response. This is transparent to consumers.
   */
  override getRawOutputSchema(): unknown {
    const baseSchema = this.rawOutputSchema;

    // Check if elicitation is enabled in scope (default: false)
    const elicitationEnabled = this.scope.metadata.elicitation?.enabled === true;

    if (elicitationEnabled && baseSchema !== undefined && baseSchema !== null) {
      // Extend schema to include elicitation fallback response type
      return extendOutputSchemaForElicitation(baseSchema as Record<string, unknown>);
    }

    return baseSchema;
  }

  /**
   * Get the provider registry for this tool.
   * Used by flows to build context-aware providers for CONTEXT-scoped dependencies.
   */
  get providers(): ProviderRegistry {
    return this._providers;
  }

  override create(input: ToolCallArgs, ctx: ToolCallExtra): ToolContext<InSchema, OutSchema, In, Out> {
    const metadata = this.metadata;
    // Use context-aware providers from flow if available, otherwise use default providers.
    // Context providers include scoped providers from plugins (e.g., RememberPlugin).
    const providers = ctx.contextProviders ?? this._providers;
    const scope = this._providers.getActiveScope();
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
      signal: ctx.signal,
    };
    switch (this.record.kind) {
      case ToolKind.CLASS_TOKEN:
        return new this.record.provide(toolCtorArgs) as ToolContext<InSchema, OutSchema, In, Out>;
      case ToolKind.FUNCTION:
        return new FunctionToolContext<InSchema, OutSchema, In, Out>(this.record, toolCtorArgs);
      default:
        // TypeScript exhaustive check - catches deprecated REMOTE or unknown kinds
        throw new InvalidRegistryKindError('tool', (this.record as { kind: string }).kind);
    }
  }

  override parseInput(input: CallToolRequest['params']): CallToolRequest['params']['arguments'] {
    // Tools backed by raw JSON Schema cannot be validated with the local Zod raw shape.
    // Preserve their object arguments instead of stripping everything to `{}`.
    // This covers remote tools plus local adapters (including ESM) that provide
    // rawInputSchema for discovery/runtime interoperability.
    const isRemoteTool = this.metadata.annotations?.['frontmcp:remote'] === true;
    const hasRawJsonSchema = this.rawInputSchema !== undefined && this.rawInputSchema !== null;

    if (isRemoteTool || hasRawJsonSchema) {
      // Pass through all arguments without stripping unknown keys
      return z.looseObject({}).parse(input.arguments ?? {});
    }

    // For local tools, use strict validation
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
  constructor(
    private readonly record: ToolFunctionTokenRecord,
    args: ToolCtorArgs<In>,
  ) {
    super(args);
  }

  execute(input: In): Promise<Out> {
    return this.record.provide(input, this);
  }
}
