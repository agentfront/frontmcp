import {
  frontMcpMetadataSchema,
  type FrontMcpConfigInput,
  type FrontMcpConfigType,
  type ScopeEntry,
} from '../../common';
import { resolveDefaultSqlitePath } from '../../common/types/options/sqlite/resolve';
import { JobRunnerBootError } from '../../errors';
import { markDirectOnly } from '../../front-mcp/direct-only.flag';
import { type JobExecutionManager } from '../execution/job-execution.manager';
import { toJobError } from '../job-attempt';
import { jobExecutionManagerOf } from '../job-run-access';
import { resolveJobsStore, type JobsConfig } from '../job-scope.helper';
import { createJobStateStore } from '../store/job-state-store.factory';
import { FINISHED_JOB_STATES } from '../store/job-state.interface';
import { JOB_WORKER_FLAG } from './detached-job.flag';

/** The server a detached runner boots: its scopes, and its shutdown. */
export interface DetachedJobHost {
  getScopes(): readonly ScopeEntry[];
  shutdown(): Promise<void>;
}

type ServerConfig = FrontMcpConfigInput | FrontMcpConfigType;

/**
 * The entry of a detached runner: boot the server's config with no transport, run the run through the job
 * execution manager of the scope that started it, and shut down. SIGTERM or SIGINT interrupts the run (its
 * cleanup runs). A boot that fails is written to the run as `JobRunnerBootError`. Resolves with the exit code.
 */
export async function runDetachedJob(
  config: ServerConfig,
  runId: string,
  boot: (config: ServerConfig) => Promise<DetachedJobHost> = bootRunner,
): Promise<number> {
  let host: DetachedJobHost;
  try {
    host = await boot(config);
  } catch (error) {
    await reportBootFailure(config, runId, error);
    return 1;
  }
  const stop = () => void host.shutdown().catch(() => undefined);
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  // The run's own timers are unref'd, and a job may only await its signal: the process lives until the run ends
  const keepAlive = setInterval(() => undefined, 60_000);
  try {
    await (await managerOf(host, runId))?.runDetached(runId);
    return 0;
  } finally {
    clearInterval(keepAlive);
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
    await host.shutdown().catch(() => undefined);
  }
}

async function bootRunner(config: ServerConfig): Promise<DetachedJobHost> {
  const { FrontMcpInstance } = await import('../../front-mcp/front-mcp.js');
  const parsed = frontMcpMetadataSchema.parse({ ...config, http: undefined, serve: false });
  markDirectOnly(parsed);
  (parsed as Record<string, unknown>)[JOB_WORKER_FLAG] = true;
  const instance = new FrontMcpInstance(parsed);
  await instance.ready;
  return instance;
}

/** The job execution manager of the scope that started the run. */
async function managerOf(host: DetachedJobHost, runId: string): Promise<JobExecutionManager | undefined> {
  for (const scope of host.getScopes()) {
    const manager = jobExecutionManagerOf(scope);
    const record = await manager?.getStatus(runId);
    if (record && (record.scopeId === undefined || record.scopeId === scope.id)) return manager;
  }
  return undefined;
}

/** Open the job store the server would and end the run with `JobRunnerBootError`, unless it was cancelled. */
async function reportBootFailure(config: ServerConfig, runId: string, cause: unknown): Promise<void> {
  const sqlite = config.sqlite && {
    ...config.sqlite,
    path: config.sqlite.path || resolveDefaultSqlitePath({ appName: config.info?.name, cliMode: false }),
  };
  const jobs = config.jobs as JobsConfig | undefined;
  const store = resolveJobsStore(jobs?.store, { redis: config.redis, sqlite });
  try {
    const { store: stateStore } = await createJobStateStore({
      redis: store?.redis,
      sqlite: store?.sqlite,
      keyPrefix: store?.keyPrefix ?? 'mcp:jobs:',
    });
    try {
      const record = await stateStore.getRun(runId);
      if (!record || FINISHED_JOB_STATES.has(record.state) || (await stateStore.isCancelRequested?.(runId))) return;
      const error = new JobRunnerBootError(runId, toJobError(cause).message);
      await stateStore.updateRun(runId, {
        state: 'failed',
        error: { name: error.name, message: error.message },
        completedAt: Date.now(),
      });
    } finally {
      await stateStore.dispose();
    }
  } catch {
    // The run stays pending; the next server that reconciles the store ends it once its runner is gone
  }
}
