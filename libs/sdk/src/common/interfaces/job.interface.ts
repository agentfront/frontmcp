import { type FrontMcpFetchInit } from '@frontmcp/auth';
import { type FuncType, type Type } from '@frontmcp/di';

import { type CallSurface } from '../availability';
import { type ToolInputOf, type ToolOutputOf } from '../decorators';
import { type ToolInputType, type ToolOutputType } from '../metadata';
import { type JobMetadata } from '../metadata/job.metadata';
import { type JobEsmTargetRecord, type JobRemoteRecord } from '../records/job.record';
import { ExecutionContextBase, type ExecutionContextBaseArgs } from './execution-context.interface';
import { FlowControl } from './flow.interface';

export type JobType<T = unknown> = Type<T> | FuncType<T> | string | JobEsmTargetRecord | JobRemoteRecord;

export type JobCtorArgs<In> = ExecutionContextBaseArgs & {
  metadata: JobMetadata;
  input: In;
  attempt: number;
  /** Aborted when the attempt stops before it finishes: it timed out, the run was cancelled, or the server shut down. */
  signal?: AbortSignal;
  /** Records what `progress()` reports on the attempt's run; a workflow step has none. */
  onProgress?: (progress: { progress: number; total?: number; message?: string }) => Promise<void>;
};

export abstract class JobContext<
  InSchema extends ToolInputType = ToolInputType,
  OutSchema extends ToolOutputType = ToolOutputType,
  In = ToolInputOf<{ inputSchema: InSchema }>,
  Out = ToolOutputOf<{ outputSchema: OutSchema }>,
> extends ExecutionContextBase<Out> {
  protected readonly jobId: string;
  protected readonly jobName: string;
  readonly metadata: JobMetadata;

  private _input: In;
  private _output?: Out;
  private readonly _attempt: number;
  private readonly _logs: string[] = [];
  private readonly onProgress?: JobCtorArgs<In>['onProgress'];

  /**
   * Aborted when the attempt stops before it finishes, with the reason as `signal.reason`: a
   * `JobTimeoutError` (or a workflow step's `WorkflowJobTimeoutError`), a `JobCancelledError` from
   * `cancel_job`, or a `JobInterruptedError` when the server shuts down. The run ends at once, while
   * `execute()` itself keeps going until it returns: pass the signal to `fetch` and other cancellable
   * work, or check it, and undo what is left in the job's `cleanup`.
   */
  declare readonly signal?: AbortSignal;

  constructor(args: JobCtorArgs<In>) {
    const { metadata, input, providers, logger, attempt, signal, onProgress } = args;
    super({
      providers,
      logger: logger.child(`job:${metadata.id ?? metadata.name}`),
      authInfo: args.authInfo,
      signal,
    });
    this.jobName = metadata.name;
    this.jobId = metadata.id ?? metadata.name;
    this.metadata = metadata;
    this._input = input;
    this._attempt = attempt;
    this.onProgress = onProgress;
  }

  abstract execute(input: In): Promise<Out>;

  /** Like {@link ExecutionContextBase.fetch}, and also aborted with {@link signal}. */
  override fetch(input: RequestInfo | URL, init?: FrontMcpFetchInit | RequestInit): Promise<Response> {
    const context = this.fetchContext(init);
    if (context && this.signal) return context.fetch(input, init, this.signal);
    return super.fetch(input, init);
  }

  get input(): In {
    return this._input;
  }

  get output(): Out | undefined {
    return this._output;
  }

  set output(v: Out | undefined) {
    this._output = v;
  }

  /** Current retry attempt number (1-based). */
  get attempt(): number {
    return this._attempt;
  }

  /** Log a message within the job execution. A functional job calls it as `ctx.log()`. */
  log(message: string): void {
    this._logs.push(`[${new Date().toISOString()}] ${message}`);
    this.logger.info(message);
  }

  /**
   * Report progress: it is kept on the run (`job://runs/{runId}` subscribers are told) and sent to the
   * session as a progress notification. Returns false when neither took it. A functional job calls it
   * as `ctx.progress()`.
   */
  async progress(pct: number, total?: number, msg?: string): Promise<boolean> {
    const recorded = this.onProgress ? await this.recordProgress({ progress: pct, total, message: msg }) : false;
    const sessionId = this.authInfo.sessionId;
    if (!sessionId) {
      this.logger.debug('Cannot send progress: no session ID');
      return recorded;
    }
    const sent = await this.scope.notifications.sendProgressNotification(sessionId, this.jobId, pct, total, msg);
    return sent || recorded;
  }

  private async recordProgress(progress: { progress: number; total?: number; message?: string }): Promise<boolean> {
    try {
      await this.onProgress?.(progress);
      return true;
    } catch (error) {
      this.logger.warn(
        `Could not record progress on the run: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /** Immediately respond with a value and stop execution. */
  respond(value: Out): never {
    this._output = value;
    FlowControl.respond<Out>(value);
  }

  /** Get all logs recorded during execution. */
  getLogs(): readonly string[] {
    return this._logs;
  }

  /** A job (or a workflow step running it) calls tools on the `'job'` surface. */
  protected override callToolSurface(): CallSurface {
    return 'job';
  }
}
