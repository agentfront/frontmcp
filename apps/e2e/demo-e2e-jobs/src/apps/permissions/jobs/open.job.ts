import { z } from '@frontmcp/lazy-zod';
import { Job, JobContext } from '@frontmcp/sdk';

/**
 * No `permissions` block. The documented contract is that such a job stays
 * available to any authenticated caller, so this guards against the fix
 * over-correcting into deny-by-default.
 */
@Job({
  name: 'open',
  description: 'Job with no permission rules',
  inputSchema: {
    value: z.string().default('x'),
  },
  outputSchema: {
    done: z.boolean(),
  },
})
export default class OpenJob extends JobContext {
  async execute(input: { value: string }) {
    return { done: input.value.length > 0 };
  }
}
