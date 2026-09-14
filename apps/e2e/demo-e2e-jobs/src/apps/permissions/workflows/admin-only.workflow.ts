import { Workflow } from '@frontmcp/sdk';

/** Workflows declare the same JobPermission[] and must be enforced identically. */
@Workflow({
  name: 'admin-only-flow',
  description: 'Admin-only workflow used to prove workflow permissions are enforced',
  trigger: 'manual',
  steps: [{ id: 'run', jobName: 'open', input: { value: 'x' } }],
  permissions: [{ action: 'execute', roles: ['admin'] }],
})
export default class AdminOnlyWorkflow {}
