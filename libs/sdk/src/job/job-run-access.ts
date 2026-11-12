import { type AuthoritiesContextBuilder } from '@frontmcp/auth';

import { type ScopeEntry } from '../common';
import { type JobPermission } from '../common/metadata/job.metadata';
import { resolveIssuer } from '../common/utils/issuer-subject.utils';
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

/** The owner of a run the caller starts: their subject and their token's issuer; none for an anonymous caller. */
export function runOwnerOf(
  authInfo: Partial<Record<string, unknown>> | undefined,
  builder: AuthoritiesContextBuilder | undefined,
): Pick<JobRunRecord, 'ownerSub' | 'ownerIss'> {
  const sub = resolvePrincipal(authInfo, builder).sub;
  if (!sub) return {};
  const iss = resolveIssuer(authInfo);
  return iss ? { ownerSub: sub, ownerIss: iss } : { ownerSub: sub };
}

/**
 * Whether the caller may read (`'read'`) or cancel (`'delete'`) a run. The caller who started it may: a
 * match on the owning issuer and subject, or on the session for a run without one (anonymous and public
 * servers). Anyone else may only when the job or workflow declares `permissions` for that action and the
 * caller passes them, so a job with no such rule keeps its runs private (GHSA-58v2-gpcc-jmqv). A run another
 * scope started is not reachable here, even when the scopes share a store.
 */
export async function mayAccessRun(
  scope: ScopeEntry,
  record: JobRunRecord | WorkflowRunRecord,
  action: 'read' | 'delete',
  authInfo: Partial<Record<string, unknown>>,
): Promise<boolean> {
  if (record.scopeId !== undefined && record.scopeId !== scope.id) return false;
  const builder = scope.authoritiesContextBuilder;
  if (record.ownerSub) {
    const caller = runOwnerOf(authInfo, builder);
    if (record.ownerSub === caller.ownerSub && record.ownerIss === caller.ownerIss) return true;
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
