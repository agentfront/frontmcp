import { FrontMcpLogger } from '../common/interfaces/logger.interface';
import { EntryOwnerRef } from '../common';
import { JobType } from '../common/interfaces/job.interface';
import { WorkflowType } from '../common/interfaces/workflow.interface';
import ProviderRegistry from '../provider/provider.registry';
import JobRegistry, { JobRegistryInterface } from './job.registry';
import WorkflowRegistry, { WorkflowRegistryInterface } from '../workflow/workflow.registry';
import { JobExecutionManager } from './execution/job-execution.manager';
import { createJobStateStore, JobStateStoreOptions } from './store/job-state-store.factory';
import { createJobDefinitionStore, JobDefinitionStoreOptions } from './store/job-definition-store.factory';
import { JobStateStore } from './store/job-state.interface';
import { JobDefinitionStore } from './store/job-definition.interface';

// Import tools
import ListJobsTool from './tools/list-jobs.tool';
import ExecuteJobTool from './tools/execute-job.tool';
import GetJobStatusTool from './tools/get-job-status.tool';
import RegisterJobTool from './tools/register-job.tool';
import RemoveJobTool from './tools/remove-job.tool';
import ListWorkflowsTool from '../workflow/tools/list-workflows.tool';
import ExecuteWorkflowTool from '../workflow/tools/execute-workflow.tool';
import GetWorkflowStatusTool from '../workflow/tools/get-workflow-status.tool';
import RegisterWorkflowTool from '../workflow/tools/register-workflow.tool';
import RemoveWorkflowTool from '../workflow/tools/remove-workflow.tool';

export interface JobsConfig {
  enabled: boolean;
  store?: {
    redis?: {
      provider: string;
      host?: string;
      port?: number;
      url?: string;
      [key: string]: unknown;
    };
    keyPrefix?: string;
  };
}

export interface RegisterJobCapabilitiesArgs {
  providers: ProviderRegistry;
  owner: EntryOwnerRef;
  jobsList: JobType[];
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
  const { providers, owner, jobsList, workflowsList, jobsConfig, logger, notifyFn } = args;

  // 1. Create stores
  const storeOpts: JobStateStoreOptions = {
    redis: jobsConfig.store?.redis,
    keyPrefix: jobsConfig.store?.keyPrefix ?? 'mcp:jobs:',
  };

  const { store: stateStore, type: stateStoreType } = createJobStateStore(storeOpts, logger);
  logger.info(`Job state store: ${stateStoreType}`);

  const defOpts: JobDefinitionStoreOptions = {
    redis: jobsConfig.store?.redis,
    keyPrefix: (jobsConfig.store?.keyPrefix ?? 'mcp:jobs:') + 'def:',
  };

  const { store: definitionStore, type: defStoreType } = createJobDefinitionStore(defOpts, logger);
  logger.info(`Job definition store: ${defStoreType}`);

  // 2. Load dynamic definitions
  const dynamicJobs = await definitionStore.listDefinitions();
  const dynamicWorkflows = await definitionStore.listWorkflowDefinitions();

  // 3. Initialize registries
  const jobRegistry = new JobRegistry(providers, jobsList, owner);
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

  // 4. Create execution manager
  const executionManager = new JobExecutionManager(stateStore, logger, notifyFn);

  // 5. Collect management tools
  const managementTools: any[] = [
    ListJobsTool,
    ExecuteJobTool,
    GetJobStatusTool,
    RegisterJobTool,
    RemoveJobTool,
    ListWorkflowsTool,
    ExecuteWorkflowTool,
    GetWorkflowStatusTool,
    RegisterWorkflowTool,
    RemoveWorkflowTool,
  ];

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
