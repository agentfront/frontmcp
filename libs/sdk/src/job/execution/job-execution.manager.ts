import { randomUUID, runRequestExclusive } from '@frontmcp/utils';

import { type ScopeEntry } from '../../common';
import { type JobEntry } from '../../common/entries/job.entry';
import { type WorkflowEntry } from '../../common/entries/workflow.entry';
import { type FrontMcpLogger } from '../../common/interfaces/logger.interface';
import { type JobPermission } from '../../common/metadata/job.metadata';
import { resolvePrincipal } from '../../common/utils/principal.utils';
import { FrontMcpContext } from '../../context';
import { JobNotAuthorizedError } from '../../errors';
import { WorkflowEngine } from '../../workflow/engine/workflow.engine';
import {
  retryDelayMs,
  runJobAttemptFlow,
  toJobError,
  willRetryJobAttempt,
  type JobAttemptOutcome,
  type JobAttemptResult,
  type JobRunRecorder,
} from '../job-attempt';
import { detachedRunContext } from '../job-context-providers';
import { JobPermissionGuard } from '../job-permission.guard';
import { type JobRegistryInterface } from '../job.registry';
import {
  type JobExecutionState,
  type JobRunRecord,
  type JobStateStore,
  type WorkflowRunRecord,
} from '../store/job-state.interface';

export interface ExecuteJobOptions {
  background?: boolean;
  sessionId?: string;
  authInfo?: Partial<Record<string, unknown>>;
  contextProviders?: unknown;
  /**
   * The caller's request context. Each attempt runs its `jobs:execute-job` flow in it, so
   * `this.context` and context accessors work inside the job; a background run gets a copy of its
   * own that outlives the request (#705), or, without one, a fresh context for `authInfo` (#700).
   */
  context?: FrontMcpContext;
  /**
   * The scope's authorities context builder, when one is configured. Passed
   * through so the permission guard resolves roles/claims using the server's
   * own `claimsMapping` rather than a second, divergent notion of where roles
   * live.
   */
  authoritiesContextBuilder?: import('@frontmcp/auth').AuthoritiesContextBuilder;
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
  private readonly scope?: ScopeEntry;

  /**
   * @param scope - The scope the manager serves. A background run without a caller context gets a
   *   fresh context of this scope; without a scope, a job's own scope is used.
   */
  constructor(
    stateStore: JobStateStore,
    logger: FrontMcpLogger,
    notifyFn?: (data: Record<string, unknown>) => Promise<void>,
    scope?: ScopeEntry,
  ) {
    this.stateStore = stateStore;
    this.logger = logger;
    this.notifyFn = notifyFn;
    this.scope = scope;
  }

  /**
   * Execute a job inline (synchronous) or in background.
   */
  async executeJob(
    job: JobEntry,
    input: unknown,
    opts: ExecuteJobOptions = {},
  ): Promise<InlineJobResult | BackgroundJobResult> {
    // Authorization choke point for a directly executed job
    // (GHSA-58v2-gpcc-jmqv) — the execute_job tool, a trigger, any in-process
    // caller. It runs BEFORE any run record is created, so an unauthorized
    // attempt leaves no state behind and background execution has no async
    // escape hatch. Each attempt's `jobs:execute-job` flow checks the
    // permissions again in its `checkJobAuthorization` stage, which is also
    // where workflow STEPS are checked (#700).
    await this.assertMayExecute(job.metadata.permissions, job.name, opts);

    const runId = randomUUID();
    const retryConfig = job.metadata.retry ?? {};
    const maxAttempts = retryConfig.maxAttempts ?? 1;

    const runRecord: JobRunRecord = {
      runId,
      jobId: job.metadata.id ?? job.name,
      jobName: job.name,
      sessionId: opts.sessionId,
      ownerSub: resolvePrincipal(opts.authInfo, opts.authoritiesContextBuilder).sub || undefined,
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
      const runOpts = withBackgroundContext(opts, (this.scope ?? job.providers.getActiveScope()).id);
      // Spawn background execution, as its own request (it outlives this one; a no-op on Node)
      runRequestExclusive(() => this.executeJobBackground(job, input, runId, runOpts)).catch(async (err) => {
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
    await this.assertMayExecute(workflow.metadata.permissions, workflow.name, opts);

    const runId = randomUUID();

    const runRecord: WorkflowRunRecord = {
      runId,
      jobId: workflow.metadata.id ?? workflow.name,
      jobName: workflow.name,
      workflowName: workflow.name,
      sessionId: opts.sessionId,
      ownerSub: resolvePrincipal(opts.authInfo, opts.authoritiesContextBuilder).sub || undefined,
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
      const runOpts = withBackgroundContext(opts, (this.scope ?? workflow.providers.getActiveScope()).id);
      runRequestExclusive(() => this.executeWorkflowBackground(workflow, jobRegistry, runId, runOpts)).catch(
        async (err) => {
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
        },
      );
      return { runId, state: 'pending' };
    }

    return this.executeWorkflowInline(workflow, jobRegistry, runId, opts);
  }

  /**
   * Throw unless the caller may execute the entry.
   *
   * Uses the same error for "not authorized" as the tools use for "not found",
   * so a caller cannot enumerate which restricted jobs exist by comparing
   * responses.
   */
  private async assertMayExecute(
    permissions: JobPermission[] | undefined,
    name: string,
    opts: ExecuteJobOptions,
  ): Promise<void> {
    const allowed = await JobPermissionGuard.check(
      permissions,
      'execute',
      opts.authInfo,
      opts.authoritiesContextBuilder,
    );
    if (!allowed) {
      this.logger.warn(`Execution of "${name}" denied: caller does not satisfy its execute permissions`);
      throw new JobNotAuthorizedError(name);
    }
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
    const run = new RunRecorder(runId, maxAttempts, (outcome) => this.recordAttempt(job, runId, outcome));

    // Each attempt is one run of the `jobs:execute-job` flow, which records how it ended (#700).
    // The first attempt always runs; `retry.maxAttempts` is at least 1.
    for (let attempt = 1; ; attempt++) {
      let answer: JobAttemptResult;
      try {
        answer = await runJobAttemptFlow({
          job,
          input,
          attempt,
          authInfo: opts.authInfo ?? {},
          context: opts.context,
          contextProviders: opts.contextProviders,
          authoritiesContextBuilder: opts.authoritiesContextBuilder,
          run,
        });
      } catch (err) {
        const error = toJobError(err);
        const retry = willRetryJobAttempt(error, attempt, maxAttempts);
        // The flow records a failed attempt, unless it failed before it could
        await run.ensureRecorded({ state: retry ? 'retrying' : 'failed', attempt, error });
        if (!retry) throw error;
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs(retryConfig, attempt)));
        continue;
      }
      // A hook may keep the flow from recording, or the run store failed its write; the run record
      // still gets the outcome. The job ran: a store error from here on is never retried.
      const { result, logs } = answer;
      await run.ensureRecorded({ state: 'completed', attempt, result, logs });
      return { runId, result, state: 'completed', logs: [...logs] };
    }
  }

  /** Write how an attempt ended to the run record, and send the run's status notification. */
  private async recordAttempt(job: JobEntry, runId: string, outcome: JobAttemptOutcome): Promise<void> {
    switch (outcome.state) {
      case 'completed':
        await this.updateState(runId, {
          state: 'completed',
          result: outcome.result,
          completedAt: Date.now(),
          attempt: outcome.attempt,
          logs: [...outcome.logs],
        });
        await this.notify({ type: 'job:status', runId, state: 'completed', jobName: job.name });
        return;
      case 'retrying':
        await this.updateState(runId, { state: 'retrying', attempt: outcome.attempt });
        await this.notify({
          type: 'job:status',
          runId,
          state: 'retrying',
          jobName: job.name,
          attempt: outcome.attempt,
        });
        return;
      case 'failed': {
        const { error } = outcome;
        await this.updateState(runId, {
          state: 'failed',
          error: { message: error.message, name: error.name, stack: error.stack },
          completedAt: Date.now(),
          attempt: outcome.attempt,
        });
        await this.notify({ type: 'job:status', runId, state: 'failed', jobName: job.name });
        return;
      }
    }
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
        context: opts.context,
        authoritiesContextBuilder: opts.authoritiesContextBuilder,
        workflowRunId: runId,
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

/**
 * A background run outlives the request, so it runs with a context of its own: a copy of the caller's
 * context (same session, auth, trace and context tokens, no transport), or, for a caller without one
 * (a trigger, in-process code), a fresh context for its auth and session in scope `scopeId`.
 */
function withBackgroundContext<Options extends ExecuteJobOptions>(opts: Options, scopeId: string): Options {
  if (opts.context) return { ...opts, context: detachedRunContext(opts.context) };
  const sessionFromAuth = opts.authInfo?.['sessionId'];
  const sessionId =
    opts.sessionId ?? (typeof sessionFromAuth === 'string' && sessionFromAuth ? sessionFromAuth : undefined);
  const context = new FrontMcpContext({
    sessionId: sessionId ?? `anon:${randomUUID()}`,
    scopeId,
    // The caller's auth as it handed it to the job execution manager
    authInfo: opts.authInfo as ConstructorParameters<typeof FrontMcpContext>[0]['authInfo'],
  });
  return { ...opts, context };
}

/**
 * The run recorder a run's attempts write through, remembering which attempts it recorded, so the
 * manager records an attempt only when its flow did not (it failed before `updateRunState`, a hook
 * kept that stage from running, or the run store failed the write).
 */
class RunRecorder implements JobRunRecorder {
  private readonly recorded = new Set<number>();

  constructor(
    readonly runId: string,
    readonly maxAttempts: number,
    private readonly write: (outcome: JobAttemptOutcome) => Promise<void>,
  ) {}

  async recordAttempt(outcome: JobAttemptOutcome): Promise<void> {
    await this.write(outcome);
    this.recorded.add(outcome.attempt);
  }

  async ensureRecorded(outcome: JobAttemptOutcome): Promise<void> {
    if (!this.recorded.has(outcome.attempt)) await this.recordAttempt(outcome);
  }
}
