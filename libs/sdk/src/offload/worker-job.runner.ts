import { isClass } from '@frontmcp/di';

import { FlowControl } from '../common/interfaces/flow.interface';
import { JobContext, type JobCtorArgs } from '../common/interfaces/job.interface';
import { type JobMetadata, type ToolInputType, type ToolOutputType } from '../common/metadata';
import { type WorkerJobAnswer, type WorkerJobProgress, type WorkerLog } from './offload-worker.globals';
import { workerLogger, WorkerProviders } from './worker-resource.reader';

type AnyJobContext = JobContext<ToolInputType, ToolOutputType, unknown, unknown>;
type WorkerJobClass = new (args: JobCtorArgs<unknown>) => AnyJobContext;
type WorkerJobHandler = (input: unknown, context: AnyJobContext) => unknown;

/** Build a `runner: 'worker'` job inside its worker, with no DI container, and run its `execute()`. */
export async function runWorkerJob(
  target: object,
  metadata: JobMetadata,
  input: unknown,
  attempt: number,
  log: WorkerLog,
  progress: (progress: WorkerJobProgress) => void,
): Promise<WorkerJobAnswer> {
  const args: JobCtorArgs<unknown> = {
    metadata,
    input,
    attempt,
    providers: new WorkerProviders(`job "${metadata.name}" runs in a worker thread (runner: 'worker')`),
    logger: workerLogger(log),
    authInfo: {},
    onProgress: async (reported) => progress(reported),
  };
  const context = isClass(target)
    ? new (target as WorkerJobClass)(args)
    : new WorkerFunctionJobContext(target as WorkerJobHandler, args);
  try {
    return { output: await context.execute(input), logs: [...context.getLogs()] };
  } catch (error) {
    if (!(error instanceof FlowControl)) throw error;
    if (error.type === 'respond') return { output: error.output, logs: [...context.getLogs()] };
    const original: unknown = Reflect.get(error, 'originalError');
    throw original ?? new Error(`The job ended with ${error.type}`);
  }
}

class WorkerFunctionJobContext extends JobContext<ToolInputType, ToolOutputType, unknown, unknown> {
  constructor(
    private readonly handler: WorkerJobHandler,
    args: JobCtorArgs<unknown>,
  ) {
    super(args);
  }

  async execute(input: unknown): Promise<unknown> {
    return this.handler(input, this);
  }
}
