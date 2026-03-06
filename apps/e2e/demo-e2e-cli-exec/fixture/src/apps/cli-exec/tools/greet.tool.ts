import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'greet',
  description: 'Greet someone with an optional greeting',
  inputSchema: {
    name: z.string().describe('Name of the person'),
    greeting: z.string().optional().describe('Custom greeting phrase'),
  },
})
export default class GreetTool extends ToolContext {
  async execute(input: { name: string; greeting?: string }) {
    const greeting = input.greeting || 'Hello';
    return { message: `${greeting}, ${input.name}!` };
  }
}
