import { randomUUID, runRequestExclusive } from '@frontmcp/utils';

import { type ScopeEntry } from '../../common';
import { type JobEntry } from '../../common/entries/job.entry';
import { type WorkflowEntry } from '../../common/entries/workflow.entry';
import { type FrontMcpLogger } from '../../common/interfaces/logger.interface';
import { type JobPermission } from '../../common/metadata/job.metadata';
import { resolvePrincipal } from '../../common/utils/principal.utils';
import { FrontMcpContext } from '../../context';
import {
  JobCancelledError,
  JobInterruptedError,
  JobNotAuthorizedError,
  JobRunFinishedError,
  JobRunNotCancellableError,
  JobRunNotFoundError,
  JobTimeoutError,
} from '../../errors';
import { WorkflowEngine } from '../../workflow/engine/workflow.engine';
import { type JobAdmission } from '../job-admission';
import {
  abortableDelay,
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
import { jobRunUri } from '../job-run-access';
import { type JobRegistryInterface } from '../job.registry';
import {
  FINISHED_JOB_STATES,
  type JobExecutionState,
  type JobRunProgress,
  type JobRunRecord,
  type JobStateStore,
  type WorkflowRunRecord,
} from '../store/job-state.interface';

/** How long an attempt of a job that sets no `timeout` may run. */
export const DEFAULT_JOB_TIMEOUT_MS = 300_000;

export interface JobExecutionManagerOptions {
  /** How long an attempt of a job that sets no `timeout` may run, in ms; 0 for no limit. @default 300000 */
  defaultTimeoutMs?: number;
  /** When attempts may start (`jobs.admission`); unset admits every attempt at once. */
  admission?: JobAdmission;
  /** How often an active run reads the store for a cancel another process wrote, in ms; unset never reads it. */
  cancelPollMs?: number;
}

/** A run this manager is executing: aborting its controller stops the run, and `settled` resolves once it ended. */
interface ActiveRun {
  controller: AbortController;
  settled: Promise<void>;
}

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
  private readonly options: JobExecutionManagerOptions;
  private readonly activeRuns = new Map<string, ActiveRun>();

  /**
   * @param scope - The scope the manager serves. A background run without a caller context gets a
   *   fresh context of this scope; without a scope, a job's own scope is used. Its subscribers to
   *   `job://runs/{runId}` are told when a run changes.
   */
  constructor(
    stateStore: JobStateStore,
    logger: FrontMcpLogger,
    notifyFn?: (data: Record<string, unknown>) => Promise<void>,
    scope?: ScopeEntry,
    options: JobExecutionManagerOptions = {},
  ) {
    this.stateStore = stateStore;
    this.logger = logger;
    this.notifyFn = notifyFn;
    this.scope = scope;
    this.options = options;
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
   * Cancel a job run: the cancel is written to the store first, where every process sharing it reads it,
   * then the run's `this.signal` is aborted with `JobCancelledError` when this process runs it (another
   * process polls the store and aborts its own run). The caller checks it may cancel the run.
   *
   * @throws JobRunNotFoundError for an unknown run
   * @throws JobRunNotCancellableError for a workflow run
   * @throws JobRunFinishedError for a run that already ended
   */
  async cancel(runId: string): Promise<void> {
    const record = await this.stateStore.getRun(runId);
    if (!record) throw new JobRunNotFoundError(runId);
    if ('workflowName' in record) throw new JobRunNotCancellableError(runId);
    if (FINISHED_JOB_STATES.has(record.state)) throw new JobRunFinishedError(runId, record.state);

    const reason = new JobCancelledError(runId);
    await this.stateStore.requestCancel(runId);
    await this.updateState(runId, {
      state: 'cancelled',
      error: { message: reason.message, name: reason.name },
      completedAt: Date.now(),
    });
    this.activeRuns.get(runId)?.controller.abort(reason);
  }

  /**
   * Interrupt every run this manager is executing, as the scope shuts down: each is aborted with
   * `JobInterruptedError`, runs its job's `cleanup`, and ends as `interrupted` before this resolves.
   */
  async dispose(): Promise<void> {
    const runs = [...this.activeRuns.entries()];
    for (const [runId, run] of runs) run.controller.abort(new JobInterruptedError(runId));
    await Promise.all(runs.map(([, run]) => run.settled));
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
    const { signal, end } = this.startRun(runId);
    try {
      return await this.runJobAttempts(job, input, runId, opts, signal);
    } finally {
      end();
    }
  }

  /** Track a run this process executes until `end()`: its abort controller, and its watch for a cancel in the store. */
  private startRun(runId: string): { signal: AbortSignal; end: () => void } {
    const controller = new AbortController();
    let settle: () => void = () => undefined;
    const settled = new Promise<void>((resolve) => (settle = resolve));
    const { cancelPollMs } = this.options;
    const watch = cancelPollMs
      ? setInterval(() => void this.abortIfCancelled(runId, controller), cancelPollMs)
      : undefined;
    watch?.unref?.();
    this.activeRuns.set(runId, { controller, settled });
    const end = () => {
      clearInterval(watch);
      this.activeRuns.delete(runId);
      settle();
    };
    return { signal: controller.signal, end };
  }

  private async abortIfCancelled(runId: string, controller: AbortController): Promise<void> {
    try {
      if (await this.stateStore.isCancelRequested(runId)) controller.abort(new JobCancelledError(runId));
    } catch (error) {
      this.logger.warn(`Could not read whether run ${runId} was cancelled: ${toJobError(error).message}`);
    }
  }

  private async runJobAttempts(
    job: JobEntry,
    input: unknown,
    runId: string,
    opts: ExecuteJobOptions,
    signal: AbortSignal,
  ): Promise<InlineJobResult> {
    // A run cancelled before it started never starts
    if (await this.stateStore.isCancelRequested(runId)) throw new JobCancelledError(runId);
    await this.updateState(runId, { state: 'running' });
    await this.notify({ type: 'job:status', runId, state: 'running', jobName: job.name });

    const retryConfig = job.metadata.retry ?? {};
    const maxAttempts = retryConfig.maxAttempts ?? 1;
    const timeoutMs = job.metadata.timeout ?? this.options.defaultTimeoutMs ?? DEFAULT_JOB_TIMEOUT_MS;
    const run = new RunRecorder(
      runId,
      maxAttempts,
      (outcome) => this.recordAttempt(job, runId, outcome),
      (progress) => this.updateState(runId, { progress }),
    );

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
          signal,
          timeoutMs,
          admission: this.options.admission,
        });
      } catch (err) {
        const error = toJobError(err);
        const retry = willRetryJobAttempt(error, attempt, maxAttempts);
        // The flow records a failed attempt, unless it failed before it could
        await run.ensureRecorded({ state: retry ? 'retrying' : 'failed', attempt, error });
        if (!retry) throw error;
        try {
          await abortableDelay(retryDelayMs(retryConfig, attempt), signal);
        } catch (stopped) {
          // Cancelled or interrupted between two attempts
          const stoppedError = toJobError(stopped);
          await run.recordAttempt({ state: 'failed', attempt, error: stoppedError });
          throw stoppedError;
        }
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
        // A cancel written to the store before the attempt ended wins: the run stays cancelled
        if (await this.stateStore.isCancelRequested(runId)) return;
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
        const state = finishedStateOf(error);
        await this.updateState(runId, {
          state,
          error: { message: error.message, name: error.name, stack: error.stack },
          completedAt: Date.now(),
          attempt: outcome.attempt,
        });
        await this.notify({ type: 'job:status', runId, state, jobName: job.name });
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
        admission: this.options.admission,
      });

      const result = await engine.execute(opts.workflowInput);

      await this.updateState(runId, {
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

  /** Write to the run record, and tell the subscribers to `job://runs/{runId}`. */
  private async updateState(runId: string, updates: Partial<JobRunRecord | WorkflowRunRecord>): Promise<void> {
    await this.stateStore.updateRun(runId, updates);
    this.scope?.resources.notifyContentChanged(jobRunUri(runId));
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
    private readonly writeProgress: (progress: JobRunProgress) => Promise<void>,
  ) {}

  recordProgress(progress: JobRunProgress): Promise<void> {
    return this.writeProgress(progress);
  }

  async recordAttempt(outcome: JobAttemptOutcome): Promise<void> {
    await this.write(outcome);
    this.recorded.add(outcome.attempt);
  }

  async ensureRecorded(outcome: JobAttemptOutcome): Promise<void> {
    if (!this.recorded.has(outcome.attempt)) await this.recordAttempt(outcome);
  }
}

/** The state a run ends in when its last attempt failed with `error`. */
function finishedStateOf(error: Error): JobExecutionState {
  if (error instanceof JobCancelledError) return 'cancelled';
  if (error instanceof JobInterruptedError) return 'interrupted';
  if (error instanceof JobTimeoutError) return 'timed_out';
  return 'failed';
}
