// file: libs/sdk/src/job/flows/execute-job.flow.ts
import type { AuthoritiesContextBuilder } from '@frontmcp/auth';
import { z } from '@frontmcp/lazy-zod';

import {
  Flow,
  FlowBase,
  FlowControl,
  FlowHooksOf,
  type FlowOutputOf,
  type FlowPlan,
  type FlowRunOptions,
  type ScopeEntry,
  type Token,
} from '../../common';
import { JobEntry } from '../../common/entries/job.entry';
import { JobContext } from '../../common/interfaces/job.interface';
import { runOnSurface } from '../../context/call-surface';
import { InternalMcpError, JobNotAuthorizedError } from '../../errors';
import { type EntryClassHooksJoin } from '../../hooks/entry-class-hooks';
import { hooksBoundTo } from '../../hooks/hooks.utils';
import {
  EXECUTE_JOB_FLOW,
  toJobError,
  willRetryJobAttempt,
  type JobAttemptOutcome,
  type JobAttemptWorkflowStep,
  type JobRunRecorder,
} from '../job-attempt';
import { jobContextProviders } from '../job-context-providers';
import { JobPermissionGuard } from '../job-permission.guard';

/** A job's input once its `inputSchema` parsed it. */
type JobInput = ReturnType<JobEntry['parseInput']>;
/** What a job's `execute()` returns, before its `outputSchema` parses it. */
type JobOutput = Parameters<JobEntry['parseOutput']>[0];

/** A job entry, typed with the default job generics that `create()` and the parse methods use. */
const jobEntrySchema = z.custom<JobEntry>((value) => value instanceof JobEntry, { message: 'Expected a job entry' });

const workflowStepSchema: z.ZodType<JobAttemptWorkflowStep> = z.object({
  name: z.string().optional(),
  stepId: z.string(),
  runId: z.string().optional(),
});

const inputSchema = z.object({
  /** The job to run, as the caller resolved it (a workflow resolves its steps from its own registry). */
  job: jobEntrySchema,
  /** The job's input, before its `inputSchema` parses it. */
  input: z.unknown(),
  /** 1 for the first attempt, 2 for the first retry, and so on. */
  attempt: z.number().int().min(1),
  ctx: z.object({
    authInfo: z.record(z.string(), z.unknown()),
    contextProviders: z.unknown().optional(),
    authoritiesContextBuilder: z.custom<AuthoritiesContextBuilder>().optional(),
    run: z.custom<JobRunRecorder>().optional(),
    workflow: workflowStepSchema.optional(),
    signal: z.instanceof(AbortSignal).optional(),
  }),
});

const outputSchema = z.object({
  /** The job's result, as its `outputSchema` parses it. */
  result: z.unknown(),
  /** What the job logged with `this.log()`. */
  logs: z.array(z.string()),
});

const stateSchema = z.object({
  job: jobEntrySchema,
  attempt: z.number(),
  /** The run this attempt belongs to; undefined for a workflow step. */
  runId: z.string().optional(),
  /** The workflow step this attempt runs for, if any. */
  workflow: workflowStepSchema.optional(),
  authInfo: z.record(z.string(), z.unknown()),
  /** The job's input as given; a hook before `validateInput` may replace it. */
  input: z.unknown(),
  /** The job's input as its `inputSchema` parsed it. */
  parsedInput: z.custom<JobInput>(),
  jobContext: z.instanceof(JobContext),
  /** What `execute()` returned, or passed to `this.respond()`. */
  output: z.custom<JobOutput>(),
  /** The attempt's answer: set by `validateOutput`, or by a hook that answered for the job with `respond()`. */
  answer: outputSchema,
  /** Why the attempt failed, set by the flow runner before the finalize stages. */
  flowError: z.instanceof(Error),
});

const plan = {
  pre: ['parseInput', 'checkJobAuthorization', 'validateInput', 'createJobContext'],
  execute: ['execute', 'validateOutput'],
  finalize: ['updateRunState', 'finalize'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'jobs:execute-job': FlowRunOptions<
      ExecuteJobFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = EXECUTE_JOB_FLOW;

/** Where the hooks a job class declares join a run: instance methods run on the instance 'createJobContext' builds. */
export const jobClassHooksJoin: EntryClassHooksJoin = { flow: name, plan, contextStage: 'createJobContext' };
const { Stage } = FlowHooksOf<'jobs:execute-job'>(name);

/** The job a run's raw input names. */
function jobOf(rawInput: unknown): JobEntry | undefined {
  const job = (rawInput as { job?: unknown } | undefined)?.job;
  return job instanceof JobEntry ? job : undefined;
}

/**
 * Runs one attempt of a job (#700). Every way a job runs goes through it: `execute_job`, inline or in
 * the background, each retry, each workflow step, and any in-process caller of the job execution
 * manager. So hooks on `jobs:execute-job` (audit, metrics, quota, authorization) see every attempt, and
 * the hooks a `@Job` class declares run on the job's own attempts.
 */
@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'authorized',
})
export default class ExecuteJobFlow extends FlowBase<typeof name> {
  /**
   * The app a job belongs to, so the hooks of an app's plugins and providers run for that app's jobs
   * only. A job the server declares outside every app runs every app's hooks.
   */
  static override resolveHookOwnerId(rawInput: unknown, scope: ScopeEntry): string | undefined {
    const job = jobOf(rawInput);
    if (!job) return undefined;
    return scope.apps.getApps().find((app) => app.providers === job.providers)?.id;
  }

  /** The class of the job, whose `static` hooks run from `parseInput` on (#701). */
  static override resolveHookEntryClass(rawInput: unknown): Token | undefined {
    return jobOf(rawInput)?.record.provide;
  }

  logger = this.scopeLogger.child('ExecuteJobFlow');

  @Stage('parseInput')
  async parseInput() {
    const { job, input, attempt, ctx } = this.input;
    this.state.set({ job, input, attempt, runId: ctx.run?.runId, workflow: ctx.workflow, authInfo: ctx.authInfo });
    this.logger = this.logger.child(`ExecuteJobFlow(${job.name})`);
    this.logger.verbose(`parseInput: attempt ${attempt}`);
  }

  /**
   * The job's `permissions` for `execute`, checked on every attempt. A denial is not retried. The job
   * execution manager also checks them when a run starts, before any run record exists, so a caller
   * that may not run the job leaves no state behind.
   */
  @Stage('checkJobAuthorization')
  async checkJobAuthorization() {
    const { job } = this.state.required;
    const allowed = await JobPermissionGuard.check(
      job.metadata.permissions,
      'execute',
      this.state.authInfo,
      this.input.ctx.authoritiesContextBuilder,
    );
    if (!allowed) {
      this.logger.warn(`checkJobAuthorization: caller does not satisfy the execute permissions of "${job.name}"`);
      throw new JobNotAuthorizedError(job.name);
    }
  }

  @Stage('validateInput')
  async validateInput() {
    const { job } = this.state.required;
    this.state.set('parsedInput', job.parseInput(this.state.input));
  }

  /**
   * Build the job's instance for this attempt, with the CONTEXT-scoped providers of the context the
   * attempt runs in (#705), and load its `this.auth`. The hooks the job class declares as instance
   * methods join the run here.
   */
  @Stage('createJobContext')
  async createJobContext() {
    const { job, parsedInput } = this.state.required;
    const { ctx, attempt } = this.input;
    // Every flow run has a context: the caller's, the background run's own, or one the flow created
    const contextProviders = ctx.contextProviders ?? (await jobContextProviders(job, this.context));
    // An attempt its caller gave up on while its providers were built never builds the job.
    this.throwIfAborted();

    const jobContext = job.create(parsedInput, {
      authInfo: this.state.authInfo ?? {},
      contextProviders,
      attempt,
      signal: ctx.signal,
    });
    // `authorities.pipes` may be async: run them before any hook or execute() reads `this.auth`.
    await jobContext.loadAuthContext();
    this.throwIfAborted();

    this.appendContextHooks(hooksBoundTo(this.scope.hooks.getClsHooks(job.record.provide), jobContext));
    this.state.set('jobContext', jobContext);
  }

  /**
   * Run the job's `execute()` on the `'job'` surface. A value passed to `this.respond()` is its result.
   * An attempt its caller gave up on while the job ran fails with the caller's reason, however the job ended.
   */
  @Stage('execute')
  async execute() {
    const { jobContext, parsedInput } = this.state.required;
    this.throwIfAborted();
    let output: unknown;
    try {
      output = await runOnSurface('job', async () => jobContext.execute(parsedInput));
    } catch (error) {
      this.throwIfAborted();
      if (!(error instanceof FlowControl && error.type === 'respond')) throw toJobError(error);
      output = error.output;
    }
    this.throwIfAborted();
    this.state.set('output', output);
  }

  /** The result must match the job's `outputSchema`; a mismatch fails the attempt, which is not retried. */
  @Stage('validateOutput')
  async validateOutput() {
    this.throwIfAborted();
    const { job, jobContext } = this.state.required;
    const result = job.parseOutput(this.state.output);
    this.state.set('answer', { result, logs: [...jobContext.getLogs()] });
  }

  /**
   * Record how the attempt ended on the run record, and notify: `completed` with its result,
   * `retrying` when another attempt follows, `failed` when none does. A workflow step has no run
   * record of its own; its workflow run records the step.
   *
   * A run store that fails the write does not fail the attempt, which would run a completed job
   * again: the attempt ends as it did, and the manager records it once more.
   */
  @Stage('updateRunState')
  async updateRunState() {
    const run = this.input.ctx.run;
    if (!run) return;
    const { attempt } = this.input;
    const { flowError, answer } = this.state;
    let outcome: JobAttemptOutcome;
    if (!flowError && answer) {
      outcome = { state: 'completed', attempt, result: answer.result, logs: answer.logs };
    } else {
      const error = flowError ?? new InternalMcpError('The job attempt ended before it produced a result');
      outcome = { state: willRetryJobAttempt(error, attempt, run.maxAttempts) ? 'retrying' : 'failed', attempt, error };
    }
    try {
      await run.recordAttempt(outcome);
    } catch (error) {
      this.logger.warn(
        `updateRunState: could not record attempt ${attempt} as ${outcome.state}: ${toJobError(error).message}`,
      );
    }
  }

  @Stage('finalize')
  async finalize() {
    const { flowError, answer } = this.state;
    if (flowError || !answer) return;
    this.respond(answer);
  }

  /** Answer for the job; a hook that answers before `validateOutput` gets its answer recorded as the result. */
  override respond(output: FlowOutputOf<typeof name>) {
    const answer = outputSchema.parse(output);
    this.state.set('answer', answer);
    throw FlowControl.respond(answer);
  }

  private throwIfAborted(): void {
    const signal = this.input.ctx.signal;
    if (!signal?.aborted) return;
    throw signal.reason instanceof Error ? signal.reason : new InternalMcpError('The job attempt was abandoned');
  }
}
