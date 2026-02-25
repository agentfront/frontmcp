import { EntryOwnerRef, ToolInputType, ToolOutputType } from '../common';
import { JobEntry } from '../common/entries/job.entry';
import { JobRecord, JobKind, JobFunctionTokenRecord } from '../common/records/job.record';
import { JobContext, JobCtorArgs } from '../common/interfaces/job.interface';
import { ToolInputOf, ToolOutputOf } from '../common/decorators';
import ProviderRegistry from '../provider/provider.registry';
import { z } from 'zod';
import HookRegistry from '../hooks/hook.registry';
import { Scope } from '../scope';
import { normalizeHooksFromCls } from '../hooks/hooks.utils';
import { InvalidHookFlowError } from '../errors/mcp.error';
import { InvalidRegistryKindError, DynamicJobDirectExecutionError } from '../errors';

/**
 * Concrete implementation of a job that can be executed.
 */
export class JobInstance<
  InSchema extends ToolInputType = ToolInputType,
  OutSchema extends ToolOutputType = ToolOutputType,
  In = ToolInputOf<{ inputSchema: InSchema }>,
  Out = ToolOutputOf<{ outputSchema: OutSchema }>,
> extends JobEntry<InSchema, OutSchema, In, Out> {
  private readonly _providers: ProviderRegistry;
  readonly scope: Scope;
  readonly hooks: HookRegistry;

  constructor(record: JobRecord, providers: ProviderRegistry, owner: EntryOwnerRef) {
    super(record);
    this.owner = owner;
    this._providers = providers;
    this.name = record.metadata.id || record.metadata.name;
    this.fullName = this.owner.id + ':' + this.name;
    this.scope = this._providers.getActiveScope();
    this.hooks = this.scope.providers.getHooksRegistry();

    const schema: any = record.metadata.inputSchema;
    this.inputSchema = schema instanceof z.ZodObject ? schema.shape : (schema ?? {});

    const outSchema: any = record.metadata.outputSchema;
    this.outputSchema = outSchema instanceof z.ZodObject ? outSchema.shape : (outSchema ?? {});

    this.ready = this.initialize();
  }

  protected async initialize() {
    if (this.record.kind === JobKind.DYNAMIC) {
      return; // Dynamic jobs don't have hooks from classes
    }

    const validFlows = ['jobs:execute-job', 'jobs:list-jobs'];
    const allHooks = normalizeHooksFromCls(this.record.provide);

    const validHooks = allHooks.filter((hook) => validFlows.includes(hook.metadata.flow));
    const invalidHooks = allHooks.filter((hook) => !validFlows.includes(hook.metadata.flow));

    if (invalidHooks.length > 0) {
      const className = (this.record.provide as any)?.name ?? 'Unknown';
      const invalidFlowNames = invalidHooks.map((h) => h.metadata.flow).join(', ');
      throw new InvalidHookFlowError(
        `Job "${className}" has hooks for unsupported flows: ${invalidFlowNames}. ` +
          `Only job flows (${validFlows.join(', ')}) are supported on job classes.`,
      );
    }

    if (validHooks.length > 0) {
      await this.hooks.registerHooks(true, ...validHooks);
    }
    return Promise.resolve();
  }

  getMetadata() {
    return this.record.metadata;
  }

  get providers(): ProviderRegistry {
    return this._providers;
  }

  override create(
    input: In,
    extra: { authInfo: Partial<Record<string, unknown>>; contextProviders?: unknown },
  ): JobContext<InSchema, OutSchema, In, Out> {
    const metadata = this.metadata;
    const providers = (extra.contextProviders ?? this._providers) as ProviderRegistry;
    const scope = this._providers.getActiveScope();
    const logger = scope.logger;
    const authInfo = extra.authInfo;

    const jobCtorArgs: JobCtorArgs<In> = {
      metadata,
      input,
      providers,
      logger,
      authInfo,
      attempt: 1,
    };

    switch (this.record.kind) {
      case JobKind.CLASS_TOKEN:
        return new this.record.provide(jobCtorArgs) as JobContext<InSchema, OutSchema, In, Out>;
      case JobKind.FUNCTION:
        return new FunctionJobContext<InSchema, OutSchema, In, Out>(this.record as JobFunctionTokenRecord, jobCtorArgs);
      case JobKind.DYNAMIC:
        throw new DynamicJobDirectExecutionError(this.name);
      default:
        throw new InvalidRegistryKindError('job', (this.record as { kind: string }).kind);
    }
  }

  override parseInput(input: unknown): In {
    const inputSchema = z.object(this.inputSchema);
    return inputSchema.parse(input) as In;
  }

  override parseOutput(raw: Out | Partial<Out>): unknown {
    if (this.outputSchema) {
      const outSchema = this.outputSchema as any;
      if (outSchema instanceof z.ZodType) {
        return outSchema.parse(raw);
      }
      if (typeof outSchema === 'object' && outSchema !== null) {
        return z.object(outSchema).parse(raw);
      }
    }
    return raw;
  }

  override safeParseOutput(
    raw: Out | Partial<Out>,
  ): { success: true; data: unknown } | { success: false; error: Error } {
    try {
      return { success: true, data: this.parseOutput(raw) };
    } catch (error: any) {
      return { success: false, error };
    }
  }
}

class FunctionJobContext<
  InSchema extends ToolInputType,
  OutSchema extends ToolOutputType,
  In = ToolInputOf<{ inputSchema: InSchema }>,
  Out = ToolOutputOf<{ outputSchema: OutSchema }>,
> extends JobContext<InSchema, OutSchema, In, Out> {
  constructor(
    private readonly record: JobFunctionTokenRecord,
    args: JobCtorArgs<In>,
  ) {
    super(args);
  }

  execute(input: In): Promise<Out> {
    return this.record.provide(input, this);
  }
}
