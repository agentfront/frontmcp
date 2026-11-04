import 'reflect-metadata';

import {
  App,
  FrontMcp,
  Job,
  JOB_WORKER_MARKER,
  JobAdmission,
  JobContext,
  JobExecutionManager,
  JobRunnerBootError,
  JobRunnerUnavailableError,
  jobRunUri,
  mayAccessRun,
  z,
  type FrontMcpLogger,
  type JobAdmissionSlot,
  type JobRunner,
  type JobRunnerInfo,
  type JobRunRecord,
  type JobStateStore,
  type ScopeEntry,
} from '@frontmcp/sdk';
import { reapOrphans } from '@frontmcp/utils';

@Job({ name: 'export', inputSchema: { dir: z.string() }, outputSchema: { files: z.number() }, runner: 'detached' })
export class ExportJob extends JobContext {
  async execute(input: { dir: string }) {
    await this.progress(1, 1, `exported ${input.dir}`);
    return { files: 1 };
  }
}

@Job({ name: 'hash', inputSchema: { text: z.string() }, outputSchema: { length: z.number() }, runner: 'worker' })
export class HashJob extends JobContext {
  async execute(input: { text: string }) {
    return { length: input.text.length };
  }
}

@App({ name: 'exports', jobs: [ExportJob, HashJob] })
class ExportsApp {}

@FrontMcp({
  info: { name: 'job-runners', version: '1.0.0' },
  apps: [ExportsApp],
  sqlite: { path: '/var/lib/exports/state.sqlite' },
  jobs: { enabled: true, runner: 'inline' },
})
export class JobRunnersServer {}

export function runnerOf(run: JobRunRecord): JobRunner | undefined {
  const runner: JobRunnerInfo | undefined = run.runner;
  return runner?.kind;
}

export function isRunnerError(error: unknown): boolean {
  return error instanceof JobRunnerUnavailableError || error instanceof JobRunnerBootError;
}

export function reapRunners(): Promise<number[]> {
  return reapOrphans(JOB_WORKER_MARKER);
}

/** A store that keeps heartbeats and claims: its runs are reconciled on boot. */
export function heartbeats(store: JobStateStore): Promise<boolean> | undefined {
  void store.touchRunner?.('runner-1', 5);
  void store.claimRun?.('run-1');
  return store.isRunnerAlive?.('runner-1');
}

@Job({
  name: 'thread',
  inputSchema: {},
  outputSchema: {},
  // @ts-expect-error a runner is 'inline', 'worker' or 'detached'
  runner: 'thread',
})
export class BadRunnerJob extends JobContext {
  async execute() {
    return {};
  }
}

@FrontMcp({
  info: { name: 'job-runners-bad', version: '1.0.0' },
  apps: [ExportsApp],
  // @ts-expect-error jobs.runner is 'inline', 'worker' or 'detached'
  jobs: { enabled: true, runner: 'process' },
})
export class BadRunnerServer {}

/** A custom host builds its own manager, bounds it with `JobAdmission`, and checks access as the job tools do (#1051). */
export function customManager(store: JobStateStore, logger: FrontMcpLogger, scope: ScopeEntry): JobExecutionManager {
  const admission = new JobAdmission({ concurrency: 2, memoryMb: 512 });
  const slot: JobAdmissionSlot = admission.slot();
  slot.release();
  return new JobExecutionManager(store, logger, undefined, scope, { admission });
}

/** `authInfo` is the caller's, as the job tools get it: the owner's subject, or the session of a run without one. */
export async function readableRunUri(
  scope: ScopeEntry,
  run: JobRunRecord,
  authInfo: Partial<Record<string, unknown>>,
): Promise<string | undefined> {
  return (await mayAccessRun(scope, run, 'read', authInfo)) ? jobRunUri(run.runId) : undefined;
}
