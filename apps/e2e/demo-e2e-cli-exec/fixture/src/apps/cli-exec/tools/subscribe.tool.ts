import { z } from 'zod';

import { Tool, ToolContext } from '@frontmcp/sdk';

@Tool({
  name: 'subscribe',
  description: 'A tool named subscribe that conflicts with the reserved command',
  inputSchema: {
    topic: z.string().describe('Topic to subscribe to'),
  },
})
export default class SubscribeTool extends ToolContext {
  async execute(input: { topic: string }) {
    return { subscribed: `Subscribed to: ${input.topic}` };
  }
}
