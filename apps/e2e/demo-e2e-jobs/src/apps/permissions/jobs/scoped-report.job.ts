import { z } from '@frontmcp/lazy-zod';
import { Job, JobContext } from '@frontmcp/sdk';

/** Gated by OAuth scope rather than role, so both rule kinds are covered. */
@Job({
  name: 'scoped-report',
  description: 'Job gated on an OAuth scope',
  inputSchema: {
    range: z.string().default('7d'),
  },
  outputSchema: {
    done: z.boolean(),
  },
  permissions: [{ action: 'execute', scopes: ['reports:run'] }],
})
export default class ScopedReportJob extends JobContext {
  async execute() {
    return { done: true };
  }
}
