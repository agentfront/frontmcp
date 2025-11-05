import {
  EntryOwnerRef, ToolCallArgs, ToolCallExtra, ToolContext,
  ToolCtorArgs, ToolEntry, ToolFunctionTokenRecord, ToolKind, ToolRecord
} from '@frontmcp/sdk';
import ProviderRegistry from '../provider/provider.registry';
import {z} from "zod";


export class ToolInstance<In = any, Out = any> extends ToolEntry<In, Out> {
  private readonly providers: ProviderRegistry;
  readonly name: string;

  constructor(record: ToolRecord, providers: ProviderRegistry, owner: EntryOwnerRef) {
    super(record);
    this.owner = owner;
    this.providers = providers;
    this.name = record.metadata.id || record.metadata.name;

    const schema: any = record.metadata.inputSchema
    this.inputSchema = typeof schema.parse === 'function' ? schema : z.object(schema);
    this.rawInputSchema = record.metadata.rawInputSchema as any;
    this.outputSchema = record.metadata.outputSchema ? z.object(record.metadata.outputSchema) : z.object({}).passthrough();
    this.ready = this.initialize();
  }

  protected initialize() {
    // TODO:
    //   - create json representation of tool based on metadata
    //   - read global tool hooks from provider registry that registered via @Hook('tool','stage')
    //   - read inline tool hooks from cls metadata that registered via @Stage('stage')
    //   - create tool invoke flow based on scope and providers and set of hooks per stage

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
        return new FunctionToolContext(this.record, toolCtorArgs);
    }
  }
}

class FunctionToolContext<In = any, Out = any> extends ToolContext<In, Out> {
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

