import { z } from '@frontmcp/lazy-zod';
import { Job, JobContext } from '@frontmcp/sdk';

/** Only admins may submit a run of it with execute_job; as a workflow step it runs for the workflow's callers. */
@Job({
  name: 'admin-submitted',
  description: 'Job whose create rule lets only admins submit a run of it',
  inputSchema: {},
  outputSchema: { marker: z.string() },
  permissions: [{ action: 'create', roles: ['admin'] }],
})
export default class AdminSubmittedJob extends JobContext {
  async execute() {
    return { marker: 'ADMIN-SUBMITTED-RAN' };
  }
}
