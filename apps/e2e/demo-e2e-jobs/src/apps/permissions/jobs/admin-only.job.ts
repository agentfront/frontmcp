import { z } from '@frontmcp/lazy-zod';
import { Job, JobContext } from '@frontmcp/sdk';

/** Destructive-looking job the e2e must never reach without the admin role. */
@Job({
  name: 'admin-only',
  description: 'Admin-only job used to prove execute permissions are enforced',
  inputSchema: {
    confirm: z.string().default('yes'),
  },
  outputSchema: {
    done: z.boolean(),
    marker: z.string(),
  },
  permissions: [{ action: 'execute', roles: ['admin'] }],
})
export default class AdminOnlyJob extends JobContext {
  async execute() {
    return { done: true, marker: 'ADMIN-JOB-RAN' };
  }
}
