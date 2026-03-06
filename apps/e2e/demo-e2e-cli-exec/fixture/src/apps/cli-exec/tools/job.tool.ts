import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'job',
  description: 'A tool named job that conflicts with the reserved command',
  inputSchema: {
    task: z.string().describe('Task to perform'),
  },
})
export default class JobTool extends ToolContext {
  async execute(input: { task: string }) {
    return { result: `Job done: ${input.task}` };
  }
}
