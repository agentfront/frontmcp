import { z } from 'zod';

import { Tool, ToolContext } from '@frontmcp/sdk';

@Tool({
  name: 'greet',
  description: 'Greet someone by name',
  inputSchema: {
    name: z.string().describe('Name to greet'),
  },
})
export default class GreetTool extends ToolContext {
  async execute(input: { name: string }) {
    const apiBase = process.env['API_BASE'] ?? 'https://api.example.com';
    return { message: `Hello, ${input.name}! (via ${apiBase})` };
  }
}
