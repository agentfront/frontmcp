import { z } from 'zod';
import { Tool, ToolContext } from '@frontmcp/react';
import type { CallToolResult } from '@frontmcp/react';

@Tool({
  name: 'greet',
  description: 'Greets a person by name',
  inputSchema: { name: z.string() },
})
export class GreetTool extends ToolContext {
  async execute(input: { name: string }): Promise<CallToolResult> {
    return {
      content: [{ type: 'text', text: `Hello, ${input.name}!` }],
    };
  }
}
