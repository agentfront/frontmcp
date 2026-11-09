import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

import { deliveries } from '../jobs/record-delivery.job';

@Tool({
  name: 'get-deliveries',
  description: 'The inputs the trigger workflows delivered to their job',
  inputSchema: {},
  outputSchema: { deliveries: z.array(z.record(z.string(), z.unknown())) },
})
export class GetDeliveriesTool extends ToolContext {
  async execute() {
    return { deliveries: [...deliveries] };
  }
}
