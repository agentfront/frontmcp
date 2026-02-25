import { randomUUID } from '@frontmcp/utils';
import { JobStateStore, JobRunRecord, WorkflowRunRecord, JobExecutionState } from '../store/job-state.interface';
import { JobEntry } from '../../common/entries/job.entry';
import { WorkflowEntry } from '../../common/entries/workflow.entry';
import { WorkflowEngine } from '../../workflow/engine/workflow.engine';
import { JobRegistryInterface } from '../job.registry';
import { FrontMcpLogger } from '../../common/interfaces/logger.interface';

export interface ExecuteJobOptions {
  background?: boolean;
  sessionId?: string;
  authInfo?: Partial<Record<string, unknown>>;
  contextProviders?: unknown;
}

export interface ExecuteWorkflowOptions extends ExecuteJobOptions {
  workflowInput?: Record<string, unknown>;
}

export interface InlineJobResult {
  runId: string;
  result: unknown;
  state: JobExecutionState;
  logs: string[];
}

export interface BackgroundJobResult {
  runId: string;
  state: 'pending';
}

/**
 * Manages job and workflow executions, both inline (synchronous)
 * and background (async with status tracking).
 */
export class JobExecutionManager {
  private readonly stateStore: JobStateStore;
  private readonly logger: FrontMcpLogger;
  private readonly notifyFn?: (data: Record<string, unknown>) => Promise<void>;

  constructor(
    stateStore: JobStateStore,
    logger: FrontMcpLogger,
    notifyFn?: (data: Record<string, unknown>) => Promise<void>,
  ) {
    this.stateStore = stateStore;
    this.logger = logger;
    this.notifyFn = notifyFn;
  }

  /**
   * Execute a job inline (synchronous) or in background.
   */
  async executeJob(
    job: JobEntry,
    input: unknown,
    opts: ExecuteJobOptions = {},
  ): Promise<InlineJobResult | BackgroundJobResult> {
    const runId = randomUUID();
    const retryConfig = job.metadata.retry ?? {};
    const maxAttempts = retryConfig.maxAttempts ?? 1;

    const runRecord: JobRunRecord = {
      runId,
      jobId: job.metadata.id ?? job.name,
      jobName: job.name,
      sessionId: opts.sessionId,
      state: 'pending',
      input,
      startedAt: Date.now(),
      attempt: 1,
      maxAttempts,
      logs: [],
      background: opts.background ?? false,
    };

    await this.stateStore.createRun(runRecord);

    if (opts.background) {
      // Spawn background execution
      this.executeJobBackground(job, input, runId, opts).catch(async (err) => {
        this.logger.error(`Background job execution failed: ${err}`);
        try {
          await this.updateState(runId, {
            state: 'failed',
            error: { message: err?.message ?? String(err), name: err?.name ?? 'Error' },
            completedAt: Date.now(),
          });
        } catch (updateErr) {
          this.logger.error(`Failed to update run state after error: ${updateErr}`);
        }
      });
      return { runId, state: 'pending' };
    }

    // Inline execution
    return this.executeJobInline(job, input, runId, opts);
  }

  /**
   * Execute a workflow inline or in background.
   */
  async executeWorkflow(
    workflow: WorkflowEntry,
    jobRegistry: JobRegistryInterface,
    opts: ExecuteWorkflowOptions = {},
  ): Promise<InlineJobResult | BackgroundJobResult> {
    const runId = randomUUID();

    const runRecord: WorkflowRunRecord = {
      runId,
      jobId: workflow.metadata.id ?? workflow.name,
      jobName: workflow.name,
      workflowName: workflow.name,
      sessionId: opts.sessionId,
      state: 'pending',
      input: opts.workflowInput,
      startedAt: Date.now(),
      attempt: 1,
      maxAttempts: 1,
      logs: [],
      background: opts.background ?? false,
      stepResults: {},
    };

    await this.stateStore.createRun(runRecord);

    if (opts.background) {
      this.executeWorkflowBackground(workflow, jobRegistry, runId, opts).catch(async (err) => {
        this.logger.error(`Background workflow execution failed: ${err}`);
        try {
          await this.updateState(runId, {
            state: 'failed',
            error: { message: err?.message ?? String(err), name: err?.name ?? 'Error' },
            completedAt: Date.now(),
          });
        } catch (updateErr) {
          this.logger.error(`Failed to update run state after error: ${updateErr}`);
        }
      });
      return { runId, state: 'pending' };
    }

    return this.executeWorkflowInline(workflow, jobRegistry, runId, opts);
  }

  /**
   * Get execution status.
   */
  async getStatus(runId: string): Promise<JobRunRecord | WorkflowRunRecord | null> {
    return this.stateStore.getRun(runId);
  }

  /**
   * List runs with optional filters.
   */
  async listRuns(opts?: {
    jobId?: string;
    sessionId?: string;
    state?: JobExecutionState;
    limit?: number;
  }): Promise<(JobRunRecord | WorkflowRunRecord)[]> {
    return this.stateStore.listRuns(opts);
  }

  // ---- Private: inline execution ----

  private async executeJobInline(
    job: JobEntry,
    input: unknown,
    runId: string,
    opts: ExecuteJobOptions,
  ): Promise<InlineJobResult> {
    await this.updateState(runId, { state: 'running' });
    await this.notify({ type: 'job:status', runId, state: 'running', jobName: job.name });

    const retryConfig = job.metadata.retry ?? {};
    const maxAttempts = retryConfig.maxAttempts ?? 1;
    const backoffMs = retryConfig.backoffMs ?? 1000;
    const backoffMultiplier = retryConfig.backoffMultiplier ?? 2;
    const maxBackoffMs = retryConfig.maxBackoffMs ?? 60000;

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const parsedInput = job.parseInput(input);
        const ctx = job.create(parsedInput, {
          authInfo: opts.authInfo ?? {},
          contextProviders: opts.contextProviders,
        });
        const result = await ctx.execute(parsedInput);
        const logs = ctx.getLogs();

        await this.updateState(runId, {
          state: 'completed',
          result,
          completedAt: Date.now(),
          attempt,
          logs: [...logs],
        });
        await this.notify({ type: 'job:status', runId, state: 'completed', jobName: job.name });

        return { runId, result, state: 'completed', logs: [...logs] };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (attempt < maxAttempts) {
          await this.updateState(runId, { state: 'retrying', attempt });
          await this.notify({ type: 'job:status', runId, state: 'retrying', jobName: job.name, attempt });
          const delay = Math.min(backoffMs * Math.pow(backoffMultiplier, attempt - 1), maxBackoffMs);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    const error = lastError ?? new Error('Job execution failed with unknown error');

    await this.updateState(runId, {
      state: 'failed',
      error: { message: error.message, name: error.name, stack: error.stack },
      completedAt: Date.now(),
    });
    await this.notify({ type: 'job:status', runId, state: 'failed', jobName: job.name });

    throw error;
  }

  // ---- Private: background execution ----

  private async executeJobBackground(
    job: JobEntry,
    input: unknown,
    runId: string,
    opts: ExecuteJobOptions,
  ): Promise<void> {
    try {
      await this.executeJobInline(job, input, runId, opts);
    } catch {
      // Error already recorded in state store
    }
  }

  private async executeWorkflowInline(
    workflow: WorkflowEntry,
    jobRegistry: JobRegistryInterface,
    runId: string,
    opts: ExecuteWorkflowOptions,
  ): Promise<InlineJobResult> {
    await this.updateState(runId, { state: 'running' });
    await this.notify({ type: 'workflow:status', runId, state: 'running', workflowName: workflow.name });

    try {
      const engine = new WorkflowEngine(workflow.metadata, jobRegistry, this.logger, {
        authInfo: opts.authInfo ?? {},
        contextProviders: opts.contextProviders,
      });

      const result = await engine.execute(opts.workflowInput);

      await this.stateStore.updateRun(runId, {
        state: result.state === 'completed' ? 'completed' : 'failed',
        result,
        completedAt: Date.now(),
      });

      await this.notify({
        type: 'workflow:status',
        runId,
        state: result.state === 'completed' ? 'completed' : 'failed',
        workflowName: workflow.name,
      });

      return { runId, result, state: result.state === 'completed' ? 'completed' : 'failed', logs: [] };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      await this.updateState(runId, {
        state: 'failed',
        error: { message: error.message, name: error.name, stack: error.stack },
        completedAt: Date.now(),
      });
      await this.notify({ type: 'workflow:status', runId, state: 'failed', workflowName: workflow.name });
      throw error;
    }
  }

  private async executeWorkflowBackground(
    workflow: WorkflowEntry,
    jobRegistry: JobRegistryInterface,
    runId: string,
    opts: ExecuteWorkflowOptions,
  ): Promise<void> {
    try {
      await this.executeWorkflowInline(workflow, jobRegistry, runId, opts);
    } catch {
      // Error already recorded in state store
    }
  }

  // ---- Helpers ----

  private async updateState(runId: string, updates: Partial<JobRunRecord | WorkflowRunRecord>): Promise<void> {
    await this.stateStore.updateRun(runId, updates);
  }

  private async notify(data: Record<string, unknown>): Promise<void> {
    if (this.notifyFn) {
      try {
        await this.notifyFn(data);
      } catch (err) {
        this.logger.warn(`Failed to send notification: ${err}`);
      }
    }
  }
}
