import { type ScopeEntry } from '../common';
import { type JobPermission } from '../common/metadata/job.metadata';
import { resolvePrincipal } from '../common/utils/principal.utils';
import type { JobExecutionManager } from './execution/job-execution.manager';
import { JobPermissionGuard } from './job-permission.guard';
import { type JobRunRecord, type WorkflowRunRecord } from './store/job-state.interface';

/** The resource a run is read from, and subscribed to. */
export function jobRunUri(runId: string): string {
  return `job://runs/${runId}`;
}

/** The job execution manager of a scope with jobs on. */
export function jobExecutionManagerOf(scope: ScopeEntry): JobExecutionManager | undefined {
  return (scope as unknown as { _jobExecutionManager?: JobExecutionManager })._jobExecutionManager;
}

/**
 * Whether the caller may read (`'read'`) or cancel (`'delete'`) a run. The caller who started it may: a
 * match on the owning subject, or on the session for a run without one (anonymous and public servers).
 * Anyone else may only when the job or workflow declares `permissions` for that action and the caller
 * passes them, so a job with no such rule keeps its runs private (GHSA-58v2-gpcc-jmqv).
 */
export async function mayAccessRun(
  scope: ScopeEntry,
  record: JobRunRecord | WorkflowRunRecord,
  action: 'read' | 'delete',
  authInfo: Partial<Record<string, unknown>>,
): Promise<boolean> {
  const builder = scope.authoritiesContextBuilder;
  if (record.ownerSub) {
    if (record.ownerSub === resolvePrincipal(authInfo, builder).sub) return true;
  } else if (record.sessionId && record.sessionId === authInfo['sessionId']) {
    return true;
  }
  const permissions = permissionsOfRun(scope, record);
  if (!permissions?.some((rule) => rule.action === action)) return false;
  return JobPermissionGuard.check(permissions, action, authInfo, builder);
}

function permissionsOfRun(scope: ScopeEntry, record: JobRunRecord | WorkflowRunRecord): JobPermission[] | undefined {
  if ('workflowName' in record) return scope.workflows?.findByName(record.workflowName)?.metadata.permissions;
  return scope.jobs?.findByName(record.jobName)?.metadata.permissions;
}
