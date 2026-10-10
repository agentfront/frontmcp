import type { AuthoritiesContextBuilder } from '@frontmcp/auth';

import { FlowControl, type ScopeEntry } from '../common';
import { type JobEntry } from '../common/entries/job.entry';
import { type JobRetryConfig } from '../common/metadata/job.metadata';
import { FrontMcpContextStorage, type FrontMcpContext } from '../context';
import { InvalidOutputError, JobNotAuthorizedError } from '../errors';

/** The flow that runs one attempt of a job. */
export const EXECUTE_JOB_FLOW = 'jobs:execute-job' as const;

/** How one attempt of a job run ended, as the run record keeps it. */
export type JobAttemptOutcome =
  | { state: 'completed'; attempt: number; result: unknown; logs: readonly string[] }
  | { state: 'retrying' | 'failed'; attempt: number; error: Error };

/**
 * Where the attempts of one job run record how they ended: the run's `JobExecutionManager`, which
 * writes the run record and sends the run's status notification. A workflow step has none: its
 * workflow run keeps the record.
 */
export interface JobRunRecorder {
  /** The run the attempts belong to. */
  readonly runId: string;
  /** The attempts the run allows, so an attempt that fails knows whether another one follows. */
  readonly maxAttempts: number;
  /** Write how an attempt ended to the run record, and notify about it. */
  recordAttempt(outcome: JobAttemptOutcome): Promise<void>;
}

/** The workflow step an attempt runs for. */
export interface JobAttemptWorkflowStep {
  /** The workflow's name. */
  name?: string;
  /** The step's id in the workflow. */
  stepId: string;
  /** The workflow run the step belongs to. */
  runId?: string;
}

/** One attempt of a job, as the `jobs:execute-job` flow runs it. */
export interface JobAttemptRequest {
  job: JobEntry;
  /** The job's input, before its `inputSchema` parses it. */
  input: unknown;
  /** 1 for the first attempt, 2 for the first retry, and so on. */
  attempt: number;
  /** The caller's auth, which the job's permissions are checked against. */
  authInfo: Partial<Record<string, unknown>>;
  /**
   * The context the attempt runs in: the caller's request context for an inline run, a context of
   * the run's own for a background run. Without one, the attempt runs in the active context, or the
   * flow creates one for `authInfo`.
   */
  context?: FrontMcpContext;
  /** Providers the caller built for the job, used only when it passes no `context`. */
  contextProviders?: unknown;
  /** The scope's authorities context builder, so the permission check reads roles as the server maps them. */
  authoritiesContextBuilder?: AuthoritiesContextBuilder;
  /** The run the attempt records its outcome on; a workflow step has none. */
  run?: JobRunRecorder;
  /** The workflow step the attempt runs for, if any. */
  workflow?: JobAttemptWorkflowStep;
  /**
   * Aborted when the caller gave up on the attempt (a workflow step's timeout): a job not started yet is
   * not started, and a started one reads it as `this.signal` while its flow ends as failed.
   */
  signal?: AbortSignal;
}

/** What a successful attempt returns. */
export interface JobAttemptResult {
  /** The job's result, as its `outputSchema` parses it. */
  result: unknown;
  /** What the job logged with `this.log()`. */
  logs: string[];
}

/**
 * Run one attempt of a job through the `jobs:execute-job` flow of the job's scope, so every hook on
 * that flow sees it: inline and background runs, each retry, and workflow steps (#700).
 *
 * @param request - The attempt to run
 * @returns The job's result and logs
 */
export async function runJobAttemptFlow(request: JobAttemptRequest): Promise<JobAttemptResult> {
  const { job, context } = request;
  const scope = job.providers.getActiveScope();
  const run = () =>
    scope.runFlowForOutput(EXECUTE_JOB_FLOW, {
      job,
      input: request.input,
      attempt: request.attempt,
      ctx: {
        authInfo: request.authInfo,
        contextProviders: context ? undefined : request.contextProviders,
        authoritiesContextBuilder: request.authoritiesContextBuilder,
        run: request.run,
        workflow: request.workflow,
        signal: request.signal,
      },
    });

  const storage = contextStorageOf(scope);
  if (!context || !storage || storage.getStore() === context) return run();
  return storage.runWithContext(context, run);
}

/**
 * Whether a failed attempt is followed by another one. A result that failed the job's `outputSchema`
 * is not retried, because the job ran to completion and running it again would repeat its side
 * effects; nor is a denial, which is not transient.
 */
export function willRetryJobAttempt(error: unknown, attempt: number, maxAttempts: number): boolean {
  if (attempt >= maxAttempts) return false;
  const cause = error instanceof FlowControl ? ((error as { originalError?: unknown }).originalError ?? error) : error;
  return !(cause instanceof InvalidOutputError) && !(cause instanceof JobNotAuthorizedError);
}

/** How long to wait before the attempt after `attempt`, from the job's (or step's) retry config. */
export function retryDelayMs(retry: JobRetryConfig, attempt: number): number {
  const backoffMs = retry.backoffMs ?? 1000;
  const backoffMultiplier = retry.backoffMultiplier ?? 2;
  const maxBackoffMs = retry.maxBackoffMs ?? 60000;
  return Math.min(backoffMs * Math.pow(backoffMultiplier, attempt - 1), maxBackoffMs);
}

/** An Error for anything thrown, as the run record keeps it. */
export function toJobError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function contextStorageOf(scope: ScopeEntry): FrontMcpContextStorage | undefined {
  try {
    return scope.providers.get(FrontMcpContextStorage);
  } catch {
    return undefined;
  }
}
