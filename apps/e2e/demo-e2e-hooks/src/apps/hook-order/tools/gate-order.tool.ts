import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

import { gateLog } from '../data/gate-log';

const outputSchema = z.object({ ran: z.array(z.string()) });

@Tool({
  name: 'gate-order',
  description: 'The gates that ran before this call, in the order they ran',
  inputSchema: {},
  outputSchema,
})
export default class GateOrderTool extends ToolContext {
  async execute(): Promise<z.infer<typeof outputSchema>> {
    return { ran: gateLog.take() };
  }
}
