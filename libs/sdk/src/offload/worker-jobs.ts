import { type JobMetadata } from '../common/metadata/job.metadata';
import { workerJobKey, workerJobRunners } from './offload-worker.globals';

/** The module a worker imports to run a job on the worker runner, the job's name and its key in the worker. */
export interface WorkerJobSource {
  file: string | undefined;
  name: string;
  key: string;
}

const sources = new WeakMap<object, WorkerJobSource>();

/**
 * Record where a job is declared (its class, or a function job's handler), and how a worker that imported that
 * module runs it.
 */
export function registerWorkerJob(target: object, metadata: JobMetadata, file: string | undefined): void {
  const key = workerJobKey(file ?? '', metadata.name, metadata.id);
  sources.set(target, { file, name: metadata.name, key });
  if (!file) return;
  const runners = workerJobRunners();
  if (runners.has(key)) {
    const withId = metadata.id === undefined ? '' : ` with id "${metadata.id}"`;
    const message = `${file} declares more than one job named "${metadata.name}"${withId}, so a worker cannot tell which one to run: give each job its own id`;
    runners.set(key, { run: () => Promise.reject(new Error(message)) });
    return;
  }
  runners.set(key, {
    run: async (input, attempt, log, progress) => {
      const { runWorkerJob } = await import('./worker-job.runner.js');
      return runWorkerJob(target, metadata, input, attempt, log, progress);
    },
  });
}

export function workerJobSourceOf(target: unknown): WorkerJobSource | undefined {
  return typeof target === 'function' ? sources.get(target) : undefined;
}
