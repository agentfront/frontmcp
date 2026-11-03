import 'reflect-metadata';

import {
  App,
  CancelJobTool,
  FrontMcp,
  Job,
  JobContext,
  JobTimeoutError,
  z,
  type JobCleanup,
  type JobExecutionState,
  type JobRunRecord,
  type JobStateStore,
} from '@frontmcp/sdk';

export const removed: string[] = [];

const removeScratch: JobCleanup = async (job, reason) => {
  const { dir } = job.input as { dir: string };
  if (job.signal?.aborted) removed.push(`${dir}:${reason}`);
};

@Job({
  name: 'build',
  inputSchema: { dir: z.string() },
  outputSchema: { ok: z.boolean() },
  timeout: 600_000,
  cleanup: removeScratch,
})
export class BuildJob extends JobContext {
  async execute(input: { dir: string }) {
    await this.progress(1, 2, `building ${input.dir}`);
    if (this.signal?.reason instanceof JobTimeoutError) return { ok: false };
    return { ok: true };
  }
}

@Job({
  name: 'test',
  inputSchema: {},
  outputSchema: {},
  cleanup: { run: () => undefined, timeoutMs: 1_000 },
})
export class TestJob extends JobContext {
  async execute() {
    return {};
  }
}

@App({ name: 'ci', jobs: [BuildJob, TestJob], tools: [CancelJobTool] })
class CiApp {}

@FrontMcp({
  info: { name: 'durable-jobs', version: '1.0.0' },
  apps: [CiApp],
  jobs: {
    enabled: true,
    store: { sqlite: { path: '/var/lib/ci/jobs.sqlite' } },
    defaultTimeoutMs: 300_000,
    admission: { concurrency: 2, memoryMb: 2_048, maxWaitMs: 600_000 },
  },
})
export class DurableJobsServer {}

export function isSettled(run: JobRunRecord): boolean {
  const settled: JobExecutionState[] = ['completed', 'failed', 'cancelled', 'timed_out', 'interrupted'];
  return settled.includes(run.state) && (run.revision ?? 0) > 0 && run.updatedAt !== undefined;
}

/** A store written before cancel requests: `cancel_job` reads a cancelled run's state from it instead. */
export class LegacyRunStore implements JobStateStore {
  private readonly runs = new Map<string, JobRunRecord>();
  async createRun(record: JobRunRecord) {
    this.runs.set(record.runId, record);
  }
  async updateRun(runId: string, updates: Partial<JobRunRecord>) {
    const run = this.runs.get(runId);
    if (run) this.runs.set(runId, { ...run, ...updates, runId });
  }
  async getRun(runId: string) {
    return this.runs.get(runId) ?? null;
  }
  async listRuns() {
    return [...this.runs.values()];
  }
  async cleanup() {
    return 0;
  }
  async dispose() {
    this.runs.clear();
  }
}

@Job({
  name: 'bad-cleanup',
  inputSchema: {},
  outputSchema: {},
  // @ts-expect-error a cleanup is a function or { run, timeoutMs }
  cleanup: 'rm -rf /tmp/scratch',
})
export class BadCleanupJob extends JobContext {
  async execute() {
    return {};
  }
}

@FrontMcp({
  info: { name: 'durable-jobs-bad', version: '1.0.0' },
  apps: [CiApp],
  // @ts-expect-error a jobs.store sqlite block needs its path
  jobs: { enabled: true, store: { sqlite: { walMode: true } } },
})
export class MissingPathServer {}
