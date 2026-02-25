import { FuncType, Type } from '@frontmcp/di';
import { WorkflowMetadata, WorkflowStepResult } from '../metadata/workflow.metadata';
import { ExecutionContextBase, ExecutionContextBaseArgs } from './execution-context.interface';

export type WorkflowType<T = unknown> = Type<T> | FuncType<T>;

export interface WorkflowExecutionResult {
  workflowName: string;
  state: 'completed' | 'failed';
  stepResults: Record<string, WorkflowStepResult>;
  startedAt: number;
  completedAt: number;
}

export type WorkflowCtorArgs = ExecutionContextBaseArgs & {
  metadata: WorkflowMetadata;
};

/**
 * WorkflowContext wraps the engine execution.
 * Unlike JobContext, this is NOT user-subclassed.
 */
export class WorkflowContext extends ExecutionContextBase<WorkflowExecutionResult> {
  readonly metadata: WorkflowMetadata;
  private _stepResults = new Map<string, WorkflowStepResult>();

  constructor(args: WorkflowCtorArgs) {
    const { metadata, providers, logger } = args;
    super({
      providers,
      logger: logger.child(`workflow:${metadata.id ?? metadata.name}`),
      authInfo: args.authInfo,
    });
    this.metadata = metadata;
  }

  get workflowName(): string {
    return this.metadata.name;
  }

  get workflowId(): string {
    return this.metadata.id ?? this.metadata.name;
  }

  get stepResults(): ReadonlyMap<string, WorkflowStepResult> {
    return this._stepResults;
  }

  /** @internal Set step result during engine execution. */
  _setStepResult(stepId: string, result: WorkflowStepResult): void {
    this._stepResults.set(stepId, result);
  }
}
