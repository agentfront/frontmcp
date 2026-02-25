import { FuncType, Type } from '@frontmcp/di';
import { ToolInputType, ToolOutputType } from '../metadata';
import { JobMetadata } from '../metadata/job.metadata';
import { FlowControl } from './flow.interface';
import { ToolInputOf, ToolOutputOf } from '../decorators';
import { ExecutionContextBase, ExecutionContextBaseArgs } from './execution-context.interface';

export type JobType<T = unknown> = Type<T> | FuncType<T>;

export type JobCtorArgs<In> = ExecutionContextBaseArgs & {
  metadata: JobMetadata;
  input: In;
  attempt: number;
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

  constructor(args: JobCtorArgs<In>) {
    const { metadata, input, providers, logger, attempt } = args;
    super({
      providers,
      logger: logger.child(`job:${metadata.id ?? metadata.name}`),
      authInfo: args.authInfo,
    });
    this.jobName = metadata.name;
    this.jobId = metadata.id ?? metadata.name;
    this.metadata = metadata;
    this._input = input;
    this._attempt = attempt;
  }

  abstract execute(input: In): Promise<Out>;

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

  /** Log a message within the job execution. */
  protected log(message: string): void {
    this._logs.push(`[${new Date().toISOString()}] ${message}`);
    this.logger.info(message);
  }

  /** Report progress. Returns false if no session is available. */
  protected async progress(pct: number, total?: number, msg?: string): Promise<boolean> {
    const sessionId = this.authInfo.sessionId;
    if (!sessionId) {
      this.logger.debug('Cannot send progress: no session ID');
      return false;
    }
    return this.scope.notifications.sendProgressNotification(sessionId, this.jobId, pct, total, msg);
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
}
