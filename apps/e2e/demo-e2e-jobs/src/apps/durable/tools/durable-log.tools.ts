import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

import { durableLog } from '../jobs/durable.jobs';

@Tool({
  name: 'get-durable-log',
  description: 'What the durable jobs logged: starts and cleanups',
  inputSchema: {},
  outputSchema: { entries: z.array(z.string()) },
})
export class GetDurableLogTool extends ToolContext {
  async execute() {
    return { entries: [...durableLog] };
  }
}
