import { getRuntimeContext, spawnOwned } from '@frontmcp/utils';

import { type JobPermission, type JobRunner } from '../../common/metadata/job.metadata';
import { JobRunnerUnavailableError } from '../../errors';
import { JOB_WORKER_MARKER, RUN_JOB_ENV_VAR } from '../../front-mcp/detached-job.flag';
import { RUN_TASK_ENV_VAR } from '../../task/helpers/cli-task-runner';

export { detachedJobRunId, JOB_WORKER_MARKER, RUN_JOB_ENV_VAR } from '../../front-mcp/detached-job.flag';

const OWNER_ARG_PREFIX = '--frontmcp-owner=';

const INLINE_REMEDY = "Set runner: 'inline' (or 'worker') on the job, or run the server where it can start processes";

interface RunnerJob {
  name: string;
  metadata: { runner?: JobRunner; permissions?: JobPermission[] };
}

/** The job's own runner, else the server's `jobs.runner`, else `'inline'`. */
export function runnerOf(job: RunnerJob, serverRunner?: JobRunner): JobRunner {
  return job.metadata.runner ?? serverRunner ?? 'inline';
}

/**
 * Refuse, at boot, a detached job where its process cannot outlive the server (an edge or browser runtime, a
 * serverless deployment) or where its attempts would check credentials its process never receives.
 */
export function assertRunnersAvailable(
  jobs: readonly RunnerJob[],
  serverRunner: JobRunner | undefined,
  runtime: { runtime: string; deployment: string } = getRuntimeContext(),
): void {
  for (const job of jobs) {
    if (runnerOf(job, serverRunner) !== 'detached') continue;
    if (runtime.runtime !== 'node') {
      throw new JobRunnerUnavailableError(
        job.name,
        `a detached run needs a process of its own, which the ${runtime.runtime} runtime cannot start`,
        INLINE_REMEDY,
      );
    }
    if (runtime.deployment === 'serverless') {
      throw new JobRunnerUnavailableError(
        job.name,
        'a detached run must outlive the server, which a serverless deployment stops or replaces after each request',
        INLINE_REMEDY,
      );
    }
    if (job.metadata.permissions?.some((rule) => rule.action === 'execute')) {
      throw new JobRunnerUnavailableError(
        job.name,
        'its execute permissions are checked on every attempt, and a detached process never receives the caller credentials',
        "Set runner: 'inline' or 'worker' on the job, or drop its execute permissions",
      );
    }
  }
}

/** The server's own command (node, its flags, its entry and arguments), which a detached runner runs again. */
export function detachedRunnerCommand(): { command: string; args: string[] } {
  const [, entry, ...args] = process.argv;
  if (!entry) {
    throw new JobRunnerUnavailableError(
      'detached',
      'the server process has no entry a detached runner can run again',
      'Start the server from its entry (node dist/main.js, frontmcp dev) to run jobs detached',
    );
  }
  const ownArgs = args.filter((arg) => !arg.startsWith(OWNER_ARG_PREFIX));
  return { command: process.execPath, args: [...process.execArgv, entry, ...ownArgs] };
}

/** The process of a detached run, as the server that starts it sees it. */
export interface DetachedRunnerProcess {
  readonly pid?: number;
  once(event: 'error', listener: (error: Error) => void): unknown;
}

/**
 * Start the process of a detached run: the server's own command, detached into a process group of its own (so a
 * stop of the server's group spares it), with the server's environment plus the run id and nothing of the caller.
 */
export function spawnDetachedRunner(runId: string): DetachedRunnerProcess {
  const { command, args } = detachedRunnerCommand();
  const env: NodeJS.ProcessEnv = { ...process.env, [RUN_JOB_ENV_VAR]: runId };
  delete env[RUN_TASK_ENV_VAR];
  const { child } = spawnOwned(command, args, {
    marker: JOB_WORKER_MARKER,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env,
  });
  child.unref();
  return child;
}
