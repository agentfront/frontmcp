import { type Token } from '@frontmcp/di';
import { type SqliteAdapterOptions } from '@frontmcp/utils';

import {
  completionEventsOf,
  completionOutputText,
  type ScopeCompletionEvents,
} from '../channel/sources/completion-events';
import { type JobCompletionEvent } from '../channel/sources/job-completion.source';
import { type EntryOwnerRef, type RedisOptionsInput } from '../common';
import { type JobType } from '../common/interfaces/job.interface';
import { type FrontMcpLogger } from '../common/interfaces/logger.interface';
import { type WorkflowType } from '../common/interfaces/workflow.interface';
import type FlowRegistry from '../flows/flow.registry';
import type ProviderRegistry from '../provider/provider.registry';
import ExecuteWorkflowTool from '../workflow/tools/execute-workflow.tool';
import GetWorkflowStatusTool from '../workflow/tools/get-workflow-status.tool';
import ListWorkflowsTool from '../workflow/tools/list-workflows.tool';
import RegisterWorkflowTool from '../workflow/tools/register-workflow.tool';
import RemoveWorkflowTool from '../workflow/tools/remove-workflow.tool';
import WorkflowRegistry, { type WorkflowRegistryInterface } from '../workflow/workflow.registry';
import { JobExecutionManager } from './execution/job-execution.manager';
import ExecuteJobFlow from './flows/execute-job.flow';
import { JobAdmission, type JobAdmissionOptions } from './job-admission';
import JobRegistry, { type JobRegistryInterface } from './job.registry';
import { JobRunResource } from './resources/job-run.resource';
import { createJobDefinitionStore } from './store/job-definition-store.factory';
import { type JobDefinitionStore } from './store/job-definition.interface';
import { createJobStateStore } from './store/job-state-store.factory';
import { type JobStateStore, type WorkflowRunRecord } from './store/job-state.interface';
import CancelJobTool from './tools/cancel-job.tool';
import ExecuteJobTool from './tools/execute-job.tool';
import GetJobStatusTool from './tools/get-job-status.tool';
// Import tools
import ListJobsTool from './tools/list-jobs.tool';
import RegisterJobTool from './tools/register-job.tool';
import RemoveJobTool from './tools/remove-job.tool';

export interface JobsConfig {
  enabled: boolean;
  /**
   * Allow `register_job` / `register_workflow` — which take a raw script string
   * and register it as an executable job — to be called at runtime.
   *
   * Off by default (GHSA-58v2-gpcc-jmqv): combined with an unguarded
   * `execute_job` this was register-and-run-arbitrary-JS for any caller who
   * could reach the tool list. Turn it on only when an agent is genuinely meant
   * to author jobs, and pair it with `permissions` on the surrounding surface.
   *
   * @default false
   */
  allowDynamicRegistration?: boolean;
  /** Where runs and dynamic definitions are kept; unset, the top-level `redis` or `sqlite` (see {@link resolveJobsStore}). */
  store?: JobsStoreConfig;
  /** How long an attempt of a job that sets no `timeout` may run, in ms; 0 for no limit. @default 300000 */
  defaultTimeoutMs?: number;
  /** When job attempts may start: at most `concurrency` at once, each claiming `memoryMb`, waiting up to `maxWaitMs`. */
  admission?: JobAdmissionOptions;
}

/** `jobs.store`: Redis, or a SQLite file the processes on one machine share; memory when neither is set. */
export interface JobsStoreConfig {
  redis?: RedisOptionsInput;
  sqlite?: SqliteAdapterOptions;
  keyPrefix?: string;
}

/** How often an active run reads a shared store for a cancel another process wrote. */
const CANCEL_POLL_MS = 1_000;

/**
 * The store jobs use: `jobs.store` when it names a backend, else the server's top-level `redis` (unless it
 * is Vercel KV, which has no key listing) with keys under its `keyPrefix` + `jobs:`, else its top-level
 * `sqlite`, else memory (undefined).
 */
export function resolveJobsStore(
  store: JobsStoreConfig | undefined,
  topLevel: { redis?: RedisOptionsInput; sqlite?: SqliteAdapterOptions },
): JobsStoreConfig | undefined {
  if (store?.redis || store?.sqlite) return store;
  const redis = topLevel.redis;
  const vercelKv = redis !== undefined && 'provider' in redis && redis.provider === 'vercel-kv';
  if (redis && !vercelKv) {
    const keyPrefix = store?.keyPrefix ?? (redis.keyPrefix === undefined ? undefined : `${redis.keyPrefix}jobs:`);
    return { ...store, redis, ...(keyPrefix === undefined ? {} : { keyPrefix }) };
  }
  if (topLevel.sqlite) return { ...store, sqlite: topLevel.sqlite };
  return store;
}

export interface RegisterJobCapabilitiesArgs {
  providers: ProviderRegistry;
  /** The scope's flow registry, where the `jobs:execute-job` flow every job attempt runs through is registered. */
  flowRegistry: FlowRegistry;
  owner: EntryOwnerRef;
  jobsList: JobType[];
  /** The provider registry of each job declared on an app, by its token (see `appEntryProviders`). */
  jobProviders?: ReadonlyMap<Token, ProviderRegistry>;
  workflowsList: WorkflowType[];
  jobsConfig: JobsConfig;
  logger: FrontMcpLogger;
  notifyFn?: (data: Record<string, unknown>) => Promise<void>;
}

export interface JobCapabilitiesResult {
  jobRegistry: JobRegistryInterface;
  workflowRegistry: WorkflowRegistryInterface;
  executionManager: JobExecutionManager;
  stateStore: JobStateStore;
  definitionStore: JobDefinitionStore;
  managementTools: any[];
}

/**
 * Helper function for registering job/workflow capabilities in scope.
 * Follows the skill-scope.helper.ts pattern.
 */
export async function registerJobCapabilities(args: RegisterJobCapabilitiesArgs): Promise<JobCapabilitiesResult> {
  const { providers, flowRegistry, owner, jobsList, jobProviders, workflowsList, jobsConfig, logger, notifyFn } = args;

  // Every attempt of every job runs through this hookable flow (#700)
  await flowRegistry.registryFlows([ExecuteJobFlow]);

  // 1. Create stores
  const { redis, sqlite } = jobsConfig.store ?? {};
  const keyPrefix = jobsConfig.store?.keyPrefix ?? 'mcp:jobs:';

  const { store: stateStore, type: stateStoreType } = await createJobStateStore({ redis, sqlite, keyPrefix }, logger);
  logger.info(`Job state store: ${stateStoreType}`);

  const { store: definitionStore, type: defStoreType } = await createJobDefinitionStore(
    { redis, sqlite, keyPrefix: keyPrefix + 'def:' },
    logger,
  );
  logger.info(`Job definition store: ${defStoreType}`);

  // 2. Load dynamic definitions
  const dynamicJobs = await definitionStore.listDefinitions();
  const dynamicWorkflows = await definitionStore.listWorkflowDefinitions();

  // 3. Initialize registries
  const jobRegistry = new JobRegistry(providers, jobsList, owner, jobProviders);
  await jobRegistry.ready;

  // Register dynamic jobs
  for (const dynJob of dynamicJobs) {
    jobRegistry.registerDynamic(dynJob);
  }

  const workflowRegistry = new WorkflowRegistry(providers, workflowsList, owner);
  await workflowRegistry.ready;

  // Register dynamic workflows
  for (const dynWf of dynamicWorkflows) {
    workflowRegistry.registerDynamic(dynWf);
  }

  // 4. Create execution manager. Its status notifications also publish finished job and workflow
  // runs to the scope's completions, which `job-completion` channel sources subscribe to.
  const scope = providers.getActiveScope();
  const completions = completionEventsOf(scope);
  const executionManager = new JobExecutionManager(
    stateStore,
    logger,
    async (data) => {
      await notifyFn?.(data);
      await publishJobCompletion(data, stateStore, completions);
    },
    scope,
    {
      defaultTimeoutMs: jobsConfig.defaultTimeoutMs,
      admission: jobsConfig.admission ? new JobAdmission(jobsConfig.admission) : undefined,
      // A store other processes share can carry a cancel this process must notice
      cancelPollMs: stateStoreType === 'memory' ? undefined : CANCEL_POLL_MS,
    },
  );
  // At shutdown the runs left are interrupted (their cleanup runs) before the stores close
  scope.onDispose(async () => {
    await executionManager.dispose(providers.shutdownHookTimeoutMs);
    await stateStore.dispose();
    await definitionStore.dispose();
  });
  scope.resources.registerDynamicResource(JobRunResource);

  // 5. Collect management tools. The dynamic-registration pair is omitted
  // unless the operator opted in — an unregistered tool cannot be called at
  // all, which is a stronger guarantee than a check inside it (the tools carry
  // that check too, as defense in depth).
  const managementTools: any[] = [
    ListJobsTool,
    ExecuteJobTool,
    GetJobStatusTool,
    CancelJobTool,
    RemoveJobTool,
    ListWorkflowsTool,
    ExecuteWorkflowTool,
    GetWorkflowStatusTool,
    RemoveWorkflowTool,
  ];

  if (jobsConfig.allowDynamicRegistration === true) {
    managementTools.push(RegisterJobTool, RegisterWorkflowTool);
    logger.warn(
      'Dynamic job registration is ENABLED: register_job/register_workflow accept a raw script and register it as an executable job.',
    );
  }

  logger.info(
    `Jobs initialized: ${jobRegistry.getJobs().length} jobs, ${workflowRegistry.getWorkflows().length} workflows`,
  );

  return {
    jobRegistry,
    workflowRegistry,
    executionManager,
    stateStore,
    definitionStore,
    managementTools,
  };
}

/**
 * Publish a finished job or workflow run (the status notification of a run that ended) as a job
 * completion, read from its run record. The event names the session that ran it, if any.
 */
async function publishJobCompletion(
  data: Record<string, unknown>,
  stateStore: JobStateStore,
  completions: ScopeCompletionEvents,
): Promise<void> {
  const { type, state, runId } = data;
  if (type !== 'job:status' && type !== 'workflow:status') return;
  const status = completionStatusOf(state);
  if (!status || typeof runId !== 'string') return;

  const run = await stateStore.getRun(runId);
  if (!run) return;
  const workflowName = type === 'workflow:status' ? (run as Partial<WorkflowRunRecord>).workflowName : undefined;
  completions.jobs.emit({
    jobName: workflowName ?? run.jobName,
    jobId: run.jobId,
    status,
    ...(run.completedAt !== undefined ? { durationMs: run.completedAt - run.startedAt } : {}),
    ...(status === 'success' ? { output: completionOutputText(run.result) } : { error: run.error?.message }),
    attempt: run.attempt,
    ...(run.sessionId ? { sessionId: run.sessionId } : {}),
  });
}

/** How a run that ended in `state` reads as a job completion; undefined while it has not ended. */
function completionStatusOf(state: unknown): JobCompletionEvent['status'] | undefined {
  switch (state) {
    case 'completed':
      return 'success';
    case 'failed':
    case 'interrupted':
      return 'error';
    case 'timed_out':
      return 'timeout';
    case 'cancelled':
      return 'cancelled';
    default:
      return undefined;
  }
}
