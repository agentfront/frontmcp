import { type Token } from '@frontmcp/di';
import { z } from '@frontmcp/lazy-zod';

import {
  type EntryOwnerRef,
  type ProviderEntry,
  type ProviderRegistryInterface,
  type ProviderViews,
  type RegistryKind,
  type RegistryType,
  type ScopeEntry,
  type ToolInputType,
  type ToolOutputType,
} from '../common';
import { type ToolInputOf, type ToolOutputOf } from '../common/decorators';
import { JobEntry } from '../common/entries/job.entry';
import { JobContext, type JobCtorArgs } from '../common/interfaces/job.interface';
import { JobKind, type JobFunctionTokenRecord, type JobRecord } from '../common/records/job.record';
import { DynamicJobDirectExecutionError, InvalidRegistryKindError, ProviderNotAvailableError } from '../errors';
import { InvalidHookFlowError, InvalidOutputError } from '../errors/mcp.error';
import type HookRegistry from '../hooks/hook.registry';
import { normalizeHooksFromCls } from '../hooks/hooks.utils';
import type ProviderRegistry from '../provider/provider.registry';

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
  readonly scope: ScopeEntry;
  readonly hooks: HookRegistry;

  constructor(record: JobRecord, providers: ProviderRegistry, owner: EntryOwnerRef) {
    super(record);
    this.owner = owner;
    this._providers = providers;
    this.name = record.metadata.id || record.metadata.name;
    this.fullName = this.owner.id + ':' + this.name;
    this.scope = this._providers.getActiveScope();
    this.hooks = this.scope.hooks;

    // inputSchema is always a ZodRawShape
    this.inputSchema = (record.metadata.inputSchema ?? {}) as InSchema;

    // outputSchema
    this.outputSchema = (record.metadata.outputSchema ?? {}) as OutSchema;

    this.ready = this.initialize();
  }

  protected async initialize() {
    if (this.record.kind === JobKind.DYNAMIC) {
      return; // Dynamic jobs don't have hooks from classes
    }

    // Jobs run through the job runner, not through a hookable flow (there is no `jobs:*` flow), so a
    // hook declared on a job class would never run. Fail fast instead of accepting it (#678).
    const hooks = normalizeHooksFromCls(this.record.provide);
    if (hooks.length > 0) {
      const className = (this.record.provide as { name?: string } | undefined)?.name ?? 'Unknown';
      const declared = hooks.map((h) => `${h.metadata.method}() on ${h.metadata.flow}`).join(', ');
      throw new InvalidHookFlowError(
        `Job "${className}" declares hooks (${declared}), but jobs do not run through a hookable flow, ` +
          `so they would never run. To act on job runs, hook the 'tools:call-tool' flow of the ` +
          `'execute_job' tool from a provider or a plugin.`,
      );
    }
  }

  getMetadata() {
    return this.record.metadata;
  }

  get providers(): ProviderRegistry {
    return this._providers;
  }

  override create(
    input: In,
    extra: { authInfo: Partial<Record<string, unknown>>; contextProviders?: unknown; attempt?: number },
  ): JobContext<InSchema, OutSchema, In, Out> {
    const metadata = this.metadata;
    const providers = extra.contextProviders
      ? new RequestOverAppProviders(extra.contextProviders as ProviderRegistryInterface, this._providers)
      : this._providers;
    const scope = this._providers.getActiveScope();
    const logger = scope.logger;
    const authInfo = extra.authInfo;

    const jobCtorArgs: JobCtorArgs<In> = {
      metadata,
      input,
      providers,
      logger,
      authInfo,
      attempt: extra.attempt ?? 1,
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

  /** The result as the job's `outputSchema` accepts it; an empty raw shape checks nothing. */
  override parseOutput(raw: Out | Partial<Out>): unknown {
    const outSchema = this.outputSchema as unknown;
    let schema: z.ZodType | undefined;
    if (outSchema instanceof z.ZodType) {
      schema = outSchema;
    } else if (outSchema && typeof outSchema === 'object' && Object.keys(outSchema).length > 0) {
      schema = z.object(outSchema as z.ZodRawShape);
    }
    if (!schema) return raw;

    const parsed = schema.safeParse(raw);
    if (parsed.success) return parsed.data;
    const firstIssue = parsed.error.issues[0];
    throw new InvalidOutputError({
      reason: 'output does not match outputSchema',
      path: firstIssue?.path.length ? firstIssue.path.join('.') : undefined,
    });
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

/** Request providers first, then the job's app registry for what the request providers don't know. */
class RequestOverAppProviders implements ProviderRegistryInterface {
  constructor(
    private readonly requestProviders: ProviderRegistryInterface,
    private readonly appProviders: ProviderRegistryInterface,
  ) {}

  get<T>(token: Token<T>): T {
    try {
      return this.requestProviders.get(token);
    } catch (error) {
      if (error instanceof ProviderNotAvailableError) return this.appProviders.get(token);
      throw error;
    }
  }

  getScope(): ScopeEntry {
    return this.requestProviders.getScope();
  }

  getProviders(): ProviderEntry[] {
    return this.requestProviders.getProviders();
  }

  getRegistries<T extends RegistryKind>(type: T): RegistryType[T][] {
    return this.requestProviders.getRegistries(type);
  }

  buildViews(
    sessionKey: string,
    contextProviders?: Map<Token, unknown>,
    contextSource?: ProviderRegistryInterface,
  ): Promise<ProviderViews> {
    return this.requestProviders.buildViews(sessionKey, contextProviders, contextSource);
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
