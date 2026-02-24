import { InternalMcpError } from './mcp.error';

export class WorkflowStepNotFoundError extends InternalMcpError {
  constructor(stepAlias: string) {
    super(`Step "${stepAlias}" has not completed yet or does not exist`, 'WORKFLOW_STEP_NOT_FOUND');
  }
}

export class WorkflowTimeoutError extends InternalMcpError {
  constructor(workflowName: string, timeoutMs: number) {
    super(`Workflow "${workflowName}" timed out after ${timeoutMs}ms`, 'WORKFLOW_TIMEOUT');
  }
}

export class WorkflowDagValidationError extends InternalMcpError {
  constructor(message: string) {
    super(message, 'WORKFLOW_DAG_VALIDATION');
  }
}

export class WorkflowJobTimeoutError extends InternalMcpError {
  constructor(jobName: string, timeoutMs: number) {
    super(`Job "${jobName}" timed out after ${timeoutMs}ms`, 'WORKFLOW_JOB_TIMEOUT');
  }
}
