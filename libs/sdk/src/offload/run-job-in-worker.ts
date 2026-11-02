import { type JobEntry } from '../common/entries/job.entry';
import { type JobCleanup } from '../common/metadata/job.metadata';
import { InvalidOffloadCallError } from '../errors/offload.errors';
import { LatestValueFlusher } from '../job/runner/run-flusher';
import { type WorkerJobAnswer, type WorkerJobProgress } from './offload-worker.globals';
import { OffloadService } from './offload.service';
import { workerJobSourceOf } from './worker-jobs';

/** The longest a timer can wait; the job's own `timeout` stops it sooner, through `signal`. */
const MAX_TIMER_MS = 2_147_483_647;

/** How often the latest progress a worker reported is kept on the run, at most. */
const PROGRESS_FLUSH_MS = 500;

/**
 * Run a `runner: 'worker'` job's `execute()` in the scope's offload pool, for the `jobs:execute-job` flow: the
 * signal terminates its worker, the latest progress it reported is reported through the attempt's instance every
 * 500 ms at most (and before its answer), and its logs join it.
 */
export async function runJobInWorker(
  jobContext: Parameters<JobCleanup>[0],
  job: JobEntry,
  input: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  const name = job.metadata.name;
  const source = workerJobSourceOf(job.record.provide);
  if (!source?.file) {
    throw new InvalidOffloadCallError(
      `job "${name}" runs on the worker runner, but the module that declares it was not found on the call stack, so no worker can import it (a bundle that inlines @frontmcp/sdk has no separate module to import)`,
    );
  }
  const progress = new LatestValueFlusher<WorkerJobProgress>(async (reported) => {
    await jobContext.progress(reported.progress, reported.total, reported.message);
  }, PROGRESS_FLUSH_MS);
  try {
    const answer = (await jobContext.get(OffloadService).run(
      { kind: 'job', file: source.file, key: source.key, name: source.name, input, attempt: jobContext.attempt },
      {
        label: name,
        budgetMs: MAX_TIMER_MS,
        signal,
        logger: jobContext.scope.logger.child(`job:${name}`),
        onProgress: (reported) => progress.push(reported),
      },
    )) as WorkerJobAnswer;
    await progress.flush();
    jobContext.keepLogs(answer.logs);
    return answer.output;
  } finally {
    progress.stop();
  }
}
