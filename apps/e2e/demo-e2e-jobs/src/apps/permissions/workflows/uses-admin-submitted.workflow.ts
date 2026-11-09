import { Workflow } from '@frontmcp/sdk';

/** Runs `admin-submitted` as a step, which its create rule doesn't gate: a step submits no run of its job. */
@Workflow({
  name: 'uses-admin-submitted',
  description: 'Workflow with a step whose job only admins may submit directly',
  steps: [{ id: 'run', jobName: 'admin-submitted' }],
})
export default class UsesAdminSubmittedWorkflow {}
