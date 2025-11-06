import {
  EntryOwnerRef, ToolCallArgs, ToolCallExtra, ToolContext,
  ToolCtorArgs, ToolEntry, ToolFunctionTokenRecord, ToolKind, ToolRecord
} from '@frontmcp/sdk';
import ProviderRegistry from '../provider/provider.registry';
import {z} from "zod";
import HookRegistry from "../hooks/hook.registry";
import {Scope} from "../scope";
import {normalizeHooksFromCls} from "../hooks/hooks.utils";


export class ToolInstance<In extends object = any, Out extends object = any> extends ToolEntry<In, Out> {
  private readonly providers: ProviderRegistry;
  readonly name: string;
  readonly scope: Scope;
  readonly hooks: HookRegistry;

  constructor(record: ToolRecord, providers: ProviderRegistry, owner: EntryOwnerRef) {
    super(record);
    this.owner = owner;
    this.providers = providers;
    this.name = record.metadata.id || record.metadata.name;
    this.scope = this.providers.getActiveScope()
    this.hooks = this.scope.providers.getHooksRegistry();

    const schema: any = record.metadata.inputSchema
    this.inputSchema = typeof schema.parse === 'function' ? schema : z.object(schema);
    this.rawInputSchema = record.metadata.rawInputSchema as any;
    this.outputSchema = record.metadata.outputSchema ? z.object(record.metadata.outputSchema) : z.object({}).passthrough();
    this.ready = this.initialize();
  }

  protected async initialize() {
    const hooks = normalizeHooksFromCls(this.record.provide)
      .filter(hook => hook.metadata.flow === 'tools:call-tool' || hook.metadata.flow === 'tools:list-tools')
    if (hooks.length > 0) {
      await this.hooks.registerHooks(true, ...hooks)
    }
    return Promise.resolve();
  }

  getMetadata() {
    return this.record.metadata;
  }

  override create(input: ToolCallArgs, ctx: ToolCallExtra): ToolContext<In, Out> {
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
    }
    switch (this.record.kind) {
      case ToolKind.CLASS_TOKEN:
        return new this.record.provide(toolCtorArgs);
      case ToolKind.FUNCTION:
        return new FunctionToolContext<In, Out>(this.record, toolCtorArgs);
    }
  }
}

class FunctionToolContext<In extends object = any, Out extends object = any> extends ToolContext<In, Out> {
  constructor(
    private readonly record: ToolFunctionTokenRecord,
    args: ToolCtorArgs<In>
  ) {
    super(args);
  }

  execute(input: In): Promise<Out> {
    return this.record.provide(input, this);
  }
}

