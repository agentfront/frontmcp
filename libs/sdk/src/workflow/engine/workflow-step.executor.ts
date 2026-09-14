import type { AuthoritiesContextBuilder } from '@frontmcp/auth';

import { type JobEntry } from '../../common/entries/job.entry';
import { type FrontMcpLogger } from '../../common/interfaces/logger.interface';
import { type JobRetryConfig } from '../../common/metadata/job.metadata';
import { type WorkflowStep, type WorkflowStepResult } from '../../common/metadata/workflow.metadata';
import { InvalidEntityError } from '../../errors';
import { JobNotAuthorizedError } from '../../errors/job.errors';
import { WorkflowJobTimeoutError } from '../../errors/workflow.errors';
import { JobPermissionGuard } from '../../job/job-permission.guard';
import { type JobRegistryInterface } from '../../job/job.registry';

export interface WorkflowStepExecutorExtra {
  authInfo: Partial<Record<string, unknown>>;
  contextProviders?: unknown;
  /**
   * The scope's authorities context builder, so a step's permission check
   * resolves roles through the server's own `claimsMapping` rather than a
   * second, divergent notion of where roles live.
   */
  authoritiesContextBuilder?: AuthoritiesContextBuilder;
}

/**
 * Executes a single workflow step by resolving the job and running it.
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

    // The step job's OWN permissions, not just the workflow's
    // (GHSA-58v2-gpcc-jmqv). `JobExecutionManager` authorizes the workflow
    // once and the engine then runs steps directly, so a workflow that
    // declares nothing would otherwise launder every job it references.
    // Checked outside the retry loop: a denial is not transient.
    const allowed = await JobPermissionGuard.check(
      job.metadata.permissions,
      'execute',
      this.extra.authInfo,
      this.extra.authoritiesContextBuilder,
    );
    if (!allowed) {
      this.logger.warn(`Step "${step.id}" denied: caller does not satisfy the execute permissions of "${job.name}"`);
      throw new JobNotAuthorizedError(job.name);
    }

    // Determine retry config (step override or job default)
    const retryConfig: JobRetryConfig = step.retry ?? job.metadata.retry ?? {};
    const maxAttempts = retryConfig.maxAttempts ?? 3;
    const backoffMs = retryConfig.backoffMs ?? 1000;
    const backoffMultiplier = retryConfig.backoffMultiplier ?? 2;
    const maxBackoffMs = retryConfig.maxBackoffMs ?? 60000;

    // Determine timeout (step override or job default)
    const timeout = step.timeout ?? job.metadata.timeout ?? 300000;

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await this.executeWithTimeout(job, input, timeout);
        return {
          outputs: (result ?? {}) as Record<string, unknown>,
          state: 'completed',
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.logger.warn(`Step "${step.id}" attempt ${attempt}/${maxAttempts} failed: ${lastError.message}`);

        if (attempt < maxAttempts) {
          const delay = Math.min(backoffMs * Math.pow(backoffMultiplier, attempt - 1), maxBackoffMs);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError ?? new Error(`Step "${step.id}" failed after ${maxAttempts} attempts`);
  }

  private async executeWithTimeout(job: JobEntry, input: Record<string, unknown>, timeout: number): Promise<unknown> {
    const parsedInput = job.parseInput(input);
    const ctx = job.create(parsedInput, {
      ...this.extra,
    });

    // Race a timer against the job promise. Note: this does NOT cancel the
    // underlying job execution — it only rejects the caller early on timeout.
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new WorkflowJobTimeoutError(job.name, timeout));
      }, timeout);

      Promise.resolve(ctx.execute(parsedInput))
        .then((result) => {
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
