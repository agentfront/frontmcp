import { type JobPermission } from '../common/metadata/job.metadata';

/** Permission actions that no operation checks: nothing creates or updates a job, a workflow or a run. */
const UNCHECKED_PERMISSION_ACTIONS = ['create', 'update'] as const;

/**
 * Describe the permission rules of a job or workflow that nothing checks, in one message. `create` and `update`
 * are accepted, but no operation creates or updates a job or its runs (`execute` decides who starts a run).
 */
export function describeUncheckedPermissions(
  kind: 'Job' | 'Workflow',
  name: string,
  permissions: readonly JobPermission[] | undefined,
): string[] {
  const unchecked = UNCHECKED_PERMISSION_ACTIONS.filter((action) =>
    permissions?.some((rule) => rule.action === action),
  );
  if (unchecked.length === 0) return [];
  const actions = unchecked.map((action) => `"${action}"`).join(' and ');
  return [
    `${kind} "${name}": its permission rules for ${actions} are never checked, so they restrict nothing: ` +
      'no operation creates or updates a job, a workflow or a run. Remove them; "execute" decides who starts a run.',
  ];
}
