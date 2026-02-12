// file: libs/sdk/src/prompt/prompt.instance.ts

import {
  EntryOwnerRef,
  PromptEntry,
  PromptGetExtra,
  ParsedPromptResult,
  PromptSafeTransformResult,
  PromptRecord,
  PromptKind,
  PromptContext,
  PromptCtorArgs,
  PromptMetadata,
  PromptFunctionTokenRecord,
} from '../common';
import ProviderRegistry from '../provider/provider.registry';
import HookRegistry from '../hooks/hook.registry';
import { Scope } from '../scope';
import { normalizeHooksFromCls } from '../hooks/hooks.utils';
import { buildParsedPromptResult } from './prompt.utils';
import { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import { MissingPromptArgumentError, InvalidRegistryKindError } from '../errors';

export class PromptInstance extends PromptEntry {
  private readonly _providers: ProviderRegistry;
  readonly scope: Scope;
  readonly hooks: HookRegistry;

  constructor(record: PromptRecord, providers: ProviderRegistry, owner: EntryOwnerRef) {
    super(record);
    this.owner = owner;
    this._providers = providers;
    this.name = record.metadata.name;
    this.fullName = this.owner.id + ':' + this.name;
    this.scope = this._providers.getActiveScope();
    this.hooks = this.scope.providers.getHooksRegistry();

    this.ready = this.initialize();
  }

  protected async initialize(): Promise<void> {
    // Register hooks for prompts:get-prompt, prompts:list-prompts flows
    const hooks = normalizeHooksFromCls(this.record.provide).filter(
      (hook) => hook.metadata.flow === 'prompts:get-prompt' || hook.metadata.flow === 'prompts:list-prompts',
    );
    if (hooks.length > 0) {
      await this.hooks.registerHooks(true, ...hooks);
    }
  }

  getMetadata(): PromptMetadata {
    return this.record.metadata;
  }

  /**
   * Get the provider registry for this prompt.
   * Used by flows to build context-aware providers for CONTEXT-scoped dependencies.
   */
  get providers(): ProviderRegistry {
    return this._providers;
  }

  /**
   * Create a prompt context (class or function wrapper).
   */
  override create(args: Record<string, string>, ctx: PromptGetExtra): PromptContext {
    const metadata = this.metadata;
    // Use context-aware providers from flow if available
    const providers = ctx.contextProviders ?? this._providers;
    const scope = this._providers.getActiveScope();
    const logger = scope.logger;
    const authInfo = ctx.authInfo;

    const promptCtorArgs: PromptCtorArgs = {
      metadata,
      args,
      providers,
      logger,
      authInfo,
    };

    const record = this.record;

    switch (record.kind) {
      case PromptKind.CLASS_TOKEN:
        return new (record.provide as unknown as new (args: PromptCtorArgs) => PromptContext)(promptCtorArgs);
      case PromptKind.FUNCTION:
        return new FunctionPromptContext(record as PromptFunctionTokenRecord, promptCtorArgs);
      default:
        // Exhaustive check: TypeScript will error if a new PromptKind is added but not handled
        // The assertion below catches runtime cases that TypeScript can't detect
        throw new InvalidRegistryKindError('prompt', (record as { kind: string }).kind);
    }
  }

  /**
   * Parse and validate arguments against the prompt's argument definitions.
   * @param args Arguments from the MCP request
   * @returns Validated arguments
   */
  override parseArguments(args?: Record<string, string>): Record<string, string> {
    const argDefs = this.metadata.arguments ?? [];
    const result: Record<string, string> = {};

    // Check required arguments
    for (const argDef of argDefs) {
      const value = args?.[argDef.name];
      if (argDef.required && (value === undefined || value === null)) {
        throw new MissingPromptArgumentError(argDef.name);
      }
      if (value !== undefined) {
        result[argDef.name] = value;
      }
    }

    // Include any additional arguments not in the definition
    if (args) {
      for (const [key, value] of Object.entries(args)) {
        if (!(key in result)) {
          result[key] = value;
        }
      }
    }

    return result;
  }

  /**
   * Convert the raw prompt return value into an MCP GetPromptResult.
   */
  override parseOutput(raw: unknown): ParsedPromptResult {
    return buildParsedPromptResult(raw, this.metadata);
  }

  /**
   * Safe version of parseOutput that returns success/error instead of throwing.
   */
  override safeParseOutput(raw: unknown): PromptSafeTransformResult<ParsedPromptResult> {
    try {
      return { success: true, data: this.parseOutput(raw) };
    } catch (error: unknown) {
      return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }
}

/**
 * Prompt context for function-decorated prompts.
 */
class FunctionPromptContext extends PromptContext {
  constructor(
    private readonly record: PromptFunctionTokenRecord,
    args: PromptCtorArgs,
  ) {
    super(args);
  }

  execute(args: Record<string, string>): Promise<GetPromptResult> {
    return this.record.provide(args, this) as Promise<GetPromptResult>;
  }
}
