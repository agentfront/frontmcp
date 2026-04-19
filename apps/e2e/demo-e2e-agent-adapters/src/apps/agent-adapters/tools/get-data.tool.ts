import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

@Tool({
  name: 'get-data',
  description: 'Retrieves data by key from mock database',
  inputSchema: {
    key: z.string().describe('The key to look up'),
  },
})
export class GetDataTool extends ToolContext {
  async execute(input: { key: string }): Promise<{ data: string; source: string }> {
    return {
      data: `value_for_${input.key}`,
      source: 'mock-db',
    };
  }
}
