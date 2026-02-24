import { WorkflowStep, WorkflowStepResult } from '../../common/metadata/workflow.metadata';
import { JobRetryConfig } from '../../common/metadata/job.metadata';
import { FrontMcpLogger } from '../../common/interfaces/logger.interface';
import { JobRegistryInterface } from '../../job/job.registry';
import { JobEntry } from '../../common/entries/job.entry';

/**
 * Executes a single workflow step by resolving the job and running it.
 */
export class WorkflowStepExecutor {
  private readonly jobRegistry: JobRegistryInterface;
  private readonly logger: FrontMcpLogger;
  private readonly extra: { authInfo: Partial<Record<string, unknown>>; contextProviders?: unknown };

  constructor(
    jobRegistry: JobRegistryInterface,
    logger: FrontMcpLogger,
    extra: { authInfo: Partial<Record<string, unknown>>; contextProviders?: unknown },
  ) {
    this.jobRegistry = jobRegistry;
    this.logger = logger;
    this.extra = extra;
  }

  async executeStep(step: WorkflowStep, input: Record<string, unknown>): Promise<WorkflowStepResult> {
    // Resolve job from registry
    const job = this.jobRegistry.findByName(step.jobName);
    if (!job) {
      throw new Error(`Job "${step.jobName}" not found for step "${step.id}"`);
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
        reject(new Error(`Job "${job.name}" timed out after ${timeout}ms`));
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
