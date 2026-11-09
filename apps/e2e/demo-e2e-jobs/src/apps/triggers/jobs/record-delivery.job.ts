import { z } from '@frontmcp/lazy-zod';
import { Job, JobContext } from '@frontmcp/sdk';

/** The inputs the trigger workflows' runs delivered, in order. */
export const deliveries: Array<Record<string, unknown>> = [];

@Job({
  name: 'record-delivery',
  description: 'Records the input its workflow run gave it',
  inputSchema: { ref: z.string().optional(), pusher: z.string().optional() },
  outputSchema: { recorded: z.number() },
})
export class RecordDeliveryJob extends JobContext {
  async execute(input: { ref?: string; pusher?: string }) {
    deliveries.push(input);
    return { recorded: deliveries.length };
  }
}
