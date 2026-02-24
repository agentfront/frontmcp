import {
  WorkflowMetadata,
  WorkflowStep,
  WorkflowStepContext,
  WorkflowStepResult,
} from '../../common/metadata/workflow.metadata';
import { WorkflowExecutionResult } from '../../common/interfaces/workflow.interface';
import { WorkflowStepExecutor } from './workflow-step.executor';
import { FrontMcpLogger } from '../../common/interfaces/logger.interface';
import { JobRegistryInterface } from '../../job/job.registry';

/**
 * DAG-based workflow execution engine.
 *
 * Algorithm:
 * 1. Validate DAG (topological sort, detect cycles)
 * 2. Build step dependency graph
 * 3. Loop:
 *    a. Find ready steps (all dependsOn completed/skipped)
 *    b. Evaluate conditions
 *    c. Compute inputs
 *    d. Execute ready steps in parallel (bounded by maxConcurrency)
 *    e. Record results
 * 4. Return WorkflowExecutionResult
 */
export class WorkflowEngine {
  private readonly metadata: WorkflowMetadata;
  private readonly stepExecutor: WorkflowStepExecutor;
  private readonly logger: FrontMcpLogger;
  private readonly maxConcurrency: number;

  constructor(
    metadata: WorkflowMetadata,
    jobRegistry: JobRegistryInterface,
    logger: FrontMcpLogger,
    extra: { authInfo: Partial<Record<string, unknown>>; contextProviders?: unknown },
  ) {
    this.metadata = metadata;
    this.logger = logger;
    this.maxConcurrency = metadata.maxConcurrency ?? 5;
    this.stepExecutor = new WorkflowStepExecutor(jobRegistry, logger, extra);
  }

  async execute(workflowInput?: Record<string, unknown>): Promise<WorkflowExecutionResult> {
    const startedAt = Date.now();
    const steps = this.metadata.steps;

    // Validate DAG
    this.validateDag(steps);

    // Step results store
    const stepResults = new Map<string, WorkflowStepResult>();

    // Build step context accessor
    const stepsContext: WorkflowStepContext = {
      get(alias: string): WorkflowStepResult {
        const result = stepResults.get(alias);
        if (!result) {
          throw new Error(`Step "${alias}" has not completed yet or does not exist`);
        }
        return result;
      },
    };

    // Track pending and completed steps
    const completed = new Set<string>();
    const failed = new Set<string>();
    const skipped = new Set<string>();
    const allStepIds = new Set(steps.map((s) => s.id));

    // Timeout handling
    const timeoutMs = this.metadata.timeout ?? 600000;
    const deadline = startedAt + timeoutMs;

    while (completed.size + failed.size + skipped.size < allStepIds.size) {
      if (Date.now() > deadline) {
        throw new Error(`Workflow "${this.metadata.name}" timed out after ${timeoutMs}ms`);
      }

      // Find ready steps: all dependsOn are completed or skipped
      const ready = steps.filter((step) => {
        if (completed.has(step.id) || failed.has(step.id) || skipped.has(step.id)) return false;
        const deps = step.dependsOn ?? [];
        return deps.every((d) => completed.has(d) || skipped.has(d));
      });

      if (ready.length === 0) {
        // Capture size before skip propagation to detect progress
        const sizeBefore = completed.size + failed.size + skipped.size;

        // Check if we have unresolvable steps (deps on failed steps)
        const remaining = steps.filter((s) => !completed.has(s.id) && !failed.has(s.id) && !skipped.has(s.id));
        for (const step of remaining) {
          const deps = step.dependsOn ?? [];
          const hasFailedDep = deps.some((d) => failed.has(d));
          if (hasFailedDep) {
            skipped.add(step.id);
            stepResults.set(step.id, { outputs: {}, state: 'skipped' });
            this.logger.info(`Skipping step "${step.id}" due to failed dependency`);
          }
        }

        // If no progress after skip propagation, break to avoid infinite loop
        const sizeAfter = completed.size + failed.size + skipped.size;
        if (sizeAfter === sizeBefore) {
          // Deadlock: mark all remaining steps as skipped
          for (const step of remaining) {
            skipped.add(step.id);
            stepResults.set(step.id, { outputs: {}, state: 'skipped' });
            this.logger.info(`Skipping step "${step.id}" — unreachable due to deadlock`);
          }
          break;
        }
        continue;
      }

      // Execute ready steps in parallel, bounded by maxConcurrency
      const batch = ready.slice(0, this.maxConcurrency);
      await Promise.allSettled(
        batch.map(async (step) => {
          // Evaluate condition
          if (step.condition) {
            try {
              const shouldRun = step.condition(stepsContext);
              if (!shouldRun) {
                skipped.add(step.id);
                stepResults.set(step.id, { outputs: {}, state: 'skipped' });
                this.logger.info(`Skipping step "${step.id}" (condition returned false)`);
                return;
              }
            } catch (err) {
              this.logger.warn(`Step "${step.id}" condition evaluation failed: ${err}`);
              skipped.add(step.id);
              stepResults.set(step.id, { outputs: {}, state: 'skipped' });
              return;
            }
          }

          // Compute input
          let input: Record<string, unknown>;
          if (typeof step.input === 'function') {
            input = step.input(stepsContext);
          } else {
            input = step.input ?? workflowInput ?? {};
          }

          // Execute step
          try {
            const result = await this.stepExecutor.executeStep(step, input);
            completed.add(step.id);
            stepResults.set(step.id, result);
            this.logger.info(`Step "${step.id}" completed successfully`);
          } catch (err) {
            if (step.continueOnError) {
              completed.add(step.id);
              stepResults.set(step.id, {
                outputs: {},
                state: 'failed',
              });
              this.logger.warn(`Step "${step.id}" failed but continueOnError=true: ${err}`);
            } else {
              failed.add(step.id);
              stepResults.set(step.id, {
                outputs: {},
                state: 'failed',
              });
              this.logger.error(`Step "${step.id}" failed: ${err}`);
            }
          }
        }),
      );
    }

    const completedAt = Date.now();
    const hasFailed = failed.size > 0;

    // Convert Map to Record
    const resultRecord: Record<string, WorkflowStepResult> = {};
    for (const [k, v] of stepResults) {
      resultRecord[k] = v;
    }

    return {
      workflowName: this.metadata.name,
      state: hasFailed ? 'failed' : 'completed',
      stepResults: resultRecord,
      startedAt,
      completedAt,
    };
  }

  /**
   * Validate the DAG: detect cycles and missing step references.
   */
  private validateDag(steps: WorkflowStep[]): void {
    const ids = new Set(steps.map((s) => s.id));

    // Check for duplicate IDs
    if (ids.size !== steps.length) {
      throw new Error('Workflow has duplicate step IDs');
    }

    // Check for missing dependencies
    for (const step of steps) {
      for (const dep of step.dependsOn ?? []) {
        if (!ids.has(dep)) {
          throw new Error(`Step "${step.id}" depends on unknown step "${dep}"`);
        }
      }
    }

    // Detect cycles using DFS
    const stepMap = new Map(steps.map((s) => [s.id, s]));
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const dfs = (id: string): void => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        throw new Error(`Workflow has a cycle involving step "${id}"`);
      }
      visiting.add(id);
      const step = stepMap.get(id);
      if (!step) {
        throw new Error(`Step "${id}" not found during cycle detection`);
      }
      for (const dep of step.dependsOn ?? []) {
        dfs(dep);
      }
      visiting.delete(id);
      visited.add(id);
    };

    for (const step of steps) {
      dfs(step.id);
    }
  }
}
