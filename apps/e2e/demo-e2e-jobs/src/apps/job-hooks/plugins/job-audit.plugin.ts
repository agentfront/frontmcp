import { JobHook, Plugin, type FlowCtxOf } from '@frontmcp/sdk';

/** One `jobs:execute-job` attempt, as the audit plugin saw it. */
export interface JobAuditEntry {
  job: string;
  attempt: number;
  outcome: 'ok' | 'error';
  runId?: string;
  workflow?: string;
  stepId?: string;
}

/** What the audit plugin recorded, newest last. */
export const jobAuditLog: JobAuditEntry[] = [];

/**
 * Audits every job attempt from the `jobs:execute-job` flow (#700): inline and background runs, each
 * retry, and each workflow step.
 */
@Plugin({ name: 'job-audit', description: 'Records every job attempt' })
export default class JobAuditPlugin {
  @JobHook.Did('updateRunState')
  recordAttempt(flowCtx: FlowCtxOf<'jobs:execute-job'>) {
    const { job, attempt, runId, workflow, flowError } = flowCtx.state;
    if (!job || attempt === undefined) return;
    jobAuditLog.push({
      job: job.name,
      attempt,
      outcome: flowError ? 'error' : 'ok',
      ...(runId ? { runId } : {}),
      ...(workflow ? { workflow: workflow.name, stepId: workflow.stepId } : {}),
    });
  }
}
