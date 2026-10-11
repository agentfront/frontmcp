import type { AuthoritiesContextBuilder } from '@frontmcp/auth';

import { type JobEntry } from '../../common/entries/job.entry';
import { type FrontMcpLogger } from '../../common/interfaces/logger.interface';
import { type JobRetryConfig } from '../../common/metadata/job.metadata';
import { type WorkflowStep, type WorkflowStepResult } from '../../common/metadata/workflow.metadata';
import { type FrontMcpContext } from '../../context';
import { InvalidEntityError } from '../../errors';
import { WorkflowJobTimeoutError } from '../../errors/workflow.errors';
import { retryDelayMs, runJobAttemptFlow, toJobError, willRetryJobAttempt } from '../../job/job-attempt';
import { type JobRegistryInterface } from '../../job/job.registry';

export interface WorkflowStepExecutorExtra {
  authInfo: Partial<Record<string, unknown>>;
  contextProviders?: unknown;
  /** The run's request context; each step's attempts run their `jobs:execute-job` flow in it (#705, #700). */
  context?: FrontMcpContext;
  /**
   * The scope's authorities context builder, so a step's permission check
   * resolves roles through the server's own `claimsMapping` rather than a
   * second, divergent notion of where roles live.
   */
  authoritiesContextBuilder?: AuthoritiesContextBuilder;
  /** The workflow the steps belong to, as hooks on `jobs:execute-job` see it in `state.workflow`. */
  workflowName?: string;
  /** The workflow run the steps belong to, as hooks on `jobs:execute-job` see it in `state.workflow`. */
  workflowRunId?: string;
}

/**
 * Executes a single workflow step by resolving the job and running each attempt of it through the
 * `jobs:execute-job` flow, which checks the STEP JOB's own permissions (GHSA-58v2-gpcc-jmqv) and runs
 * every hook on that flow (#700).
 */
export class WorkflowStepExecutor {
  private readonly jobRegistry: JobRegistryInterface;
  private readonly logger: FrontMcpLogger;
  private readonly extra: WorkflowStepExecutorExtra;

  constructor(jobRegistry: JobRegistryInterface, logger: FrontMcpLogger, extra: WorkflowStepExecutorExtra) {
    this.jobRegistry = jobRegistry;
    this.logger = logger;
    this.extra = extra;
  }

  async executeStep(step: WorkflowStep, input: Record<string, unknown>): Promise<WorkflowStepResult> {
    // Resolve job from registry
    const job = this.jobRegistry.findByName(step.jobName);
    if (!job) {
      throw new InvalidEntityError('job', step.jobName, `a registered job (referenced by step "${step.id}")`);
    }

    // Determine retry config (step override or job default)
    const retryConfig: JobRetryConfig = step.retry ?? job.metadata.retry ?? {};
    const maxAttempts = retryConfig.maxAttempts ?? 3;

    // Determine timeout (step override or job default)
    const timeout = step.timeout ?? job.metadata.timeout ?? 300000;

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await this.executeWithTimeout(job, step, input, timeout, attempt);
        return {
          outputs: (result ?? {}) as Record<string, unknown>,
          state: 'completed',
        };
      } catch (err) {
        lastError = toJobError(err);
        this.logger.warn(`Step "${step.id}" attempt ${attempt}/${maxAttempts} failed: ${lastError.message}`);
        // A result that failed outputSchema, or a denial of the step job, is not retried
        if (!willRetryJobAttempt(lastError, attempt, maxAttempts)) break;
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs(retryConfig, attempt)));
      }
    }

    throw lastError ?? new Error(`Step "${step.id}" failed after ${maxAttempts} attempts`);
  }

  /**
   * Run one attempt, racing a timer. On a timeout the attempt is rejected and its flow aborted: a job
   * not started yet never starts, and a started one sees `this.signal` aborted while its flow ends as
   * failed (its `Did('execute')` hooks don't run). The timer does not stop `execute()` itself.
   */
  private executeWithTimeout(
    job: JobEntry,
    step: WorkflowStep,
    input: Record<string, unknown>,
    timeout: number,
    attempt: number,
  ): Promise<unknown> {
    const { context, contextProviders, authInfo, authoritiesContextBuilder, workflowName, workflowRunId } = this.extra;
    const abandon = new AbortController();

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        const timedOut = new WorkflowJobTimeoutError(job.name, timeout);
        abandon.abort(timedOut);
        reject(timedOut);
      }, timeout);

      runJobAttemptFlow({
        job,
        input,
        attempt,
        authInfo,
        context,
        contextProviders,
        authoritiesContextBuilder,
        workflow: { name: workflowName, stepId: step.id, runId: workflowRunId },
        signal: abandon.signal,
      })
        .then(({ result }) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }
}
