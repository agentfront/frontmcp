import { isClass } from '@frontmcp/di';

import { collectAppMetadata } from '../../app/app.utils';
import {
  frontMcpMetadataSchema,
  type AppType,
  type FrontMcpConfigInput,
  type FrontMcpConfigType,
  type ScopeEntry,
} from '../../common';
import { resolveDefaultSqlitePath } from '../../common/types/options/sqlite/resolve';
import { JobRunnerBootError } from '../../errors';
import { JOB_WORKER_FLAG, RUN_JOB_ENV_VAR } from '../../front-mcp/detached-job.flag';
import { markDirectOnly } from '../../front-mcp/direct-only.flag';
import { normalizeWorkflow } from '../../workflow/workflow.utils';
import { type JobExecutionManager } from '../execution/job-execution.manager';
import { toJobError } from '../job-attempt';
import { jobExecutionManagerOf } from '../job-run-access';
import { resolveJobsStore, type JobsConfig } from '../job-scope.helper';
import { normalizeJob } from '../job.utils';
import { createJobStateStore } from '../store/job-state-store.factory';
import {
  FINISHED_JOB_STATES,
  type JobRunRecord,
  type JobStateStore,
  type WorkflowRunRecord,
} from '../store/job-state.interface';

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
 * The run id leaves the environment first, so a server the job starts does not boot as a runner too.
 */
export async function runDetachedJob(
  config: ServerConfig,
  runId: string,
  boot: (config: ServerConfig) => Promise<DetachedJobHost> = bootRunner,
): Promise<number> {
  delete process.env[RUN_JOB_ENV_VAR];
  let host: DetachedJobHost;
  try {
    host = await boot(await configForRun(config, runId));
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

/** The job store the server would open. */
async function openRunStore(config: ServerConfig): Promise<JobStateStore> {
  const sqlite = config.sqlite && {
    ...config.sqlite,
    path: config.sqlite.path || resolveDefaultSqlitePath({ appName: config.info?.name, cliMode: false }),
  };
  const jobs = config.jobs as JobsConfig | undefined;
  const store = resolveJobsStore(jobs?.store, { redis: config.redis, sqlite });
  const { store: stateStore } = await createJobStateStore({
    redis: store?.redis,
    sqlite: store?.sqlite,
    keyPrefix: store?.keyPrefix ?? 'mcp:jobs:',
  });
  return stateStore;
}

/**
 * The config a runner boots for `runId`: the server's, or with `jobs.detached.boot: 'app'`, the server's with only the
 * apps the run needs (see {@link appsForRun}); the whole config when the run can't be read or its apps can't be found.
 */
async function configForRun(config: ServerConfig, runId: string): Promise<ServerConfig> {
  const jobs = config.jobs as JobsConfig | undefined;
  if (jobs?.detached?.boot !== 'app' || !Array.isArray(config.apps)) return config;
  let record: JobRunRecord | WorkflowRunRecord | null;
  try {
    const store = await openRunStore(config);
    try {
      record = await store.getRun(runId);
    } finally {
      await store.dispose();
    }
  } catch {
    return config;
  }
  const apps = record ? appsForRun(config.apps as readonly unknown[], record) : undefined;
  return apps ? ({ ...config, apps } as ServerConfig) : config;
}

/**
 * The apps a run needs, of `apps` in their order: the app that declares its job, or for a workflow run, the app that
 * declares the workflow and those that declare its steps' jobs. Undefined when one of them is on no app declared as a
 * class (a job registered at runtime, an app loaded from a package), so the whole config boots.
 */
export function appsForRun(
  apps: readonly unknown[],
  run: Pick<JobRunRecord, 'jobName'> & { workflowName?: string },
): unknown[] | undefined {
  const declared = apps.map((app) => {
    if (!isClass(app)) return { app, jobs: new Set<string>(), workflows: new Map<string, string[]>() };
    const metadata = collectAppMetadata(app as AppType) as { jobs?: unknown[]; workflows?: unknown[] };
    const jobs = new Set((metadata.jobs ?? []).map((job) => normalizeJob(job).metadata.name));
    const workflows = new Map(
      (metadata.workflows ?? []).map((workflow) => {
        const { metadata: flow } = normalizeWorkflow(workflow);
        return [flow.name, flow.steps.map((step) => step.jobName)] as const;
      }),
    );
    return { app, jobs, workflows };
  });
  const needed = new Set<unknown>();
  const take = (found: (typeof declared)[number] | undefined): boolean => {
    if (found) needed.add(found.app);
    return found !== undefined;
  };
  const { workflowName } = run;
  if (workflowName !== undefined) {
    const owner = declared.find(({ workflows }) => workflows.has(workflowName));
    if (!take(owner)) return undefined;
    for (const jobName of owner?.workflows.get(workflowName) ?? []) {
      if (!take(declared.find(({ jobs }) => jobs.has(jobName)))) return undefined;
    }
  } else if (!take(declared.find(({ jobs }) => jobs.has(run.jobName)))) {
    return undefined;
  }
  return apps.filter((app) => needed.has(app));
}

/** Open the job store the server would and end the run with `JobRunnerBootError`, unless it was cancelled. */
async function reportBootFailure(config: ServerConfig, runId: string, cause: unknown): Promise<void> {
  try {
    const stateStore = await openRunStore(config);
    try {
      const record = await stateStore.getRun(runId);
      if (!record || FINISHED_JOB_STATES.has(record.state) || (await stateStore.isCancelRequested?.(runId))) return;
      const error = new JobRunnerBootError(runId, toJobError(cause).message);
      const failed = {
        state: 'failed' as const,
        error: { name: error.name, message: error.message },
        completedAt: Date.now(),
      };
      if (stateStore.updateUnfinishedRun) await stateStore.updateUnfinishedRun(runId, failed);
      else await stateStore.updateRun(runId, failed);
    } finally {
      await stateStore.dispose();
    }
  } catch {
    // The run stays pending; the next server that reconciles the store ends it once its runner is gone
  }
}
