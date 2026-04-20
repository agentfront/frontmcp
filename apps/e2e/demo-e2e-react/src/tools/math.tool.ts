import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext, type CallToolResult } from '@frontmcp/react';

@Tool({
  name: 'add',
  description: 'Adds two numbers',
  inputSchema: { a: z.number(), b: z.number() },
})
export class AddTool extends ToolContext {
  async execute(input: { a: number; b: number }): Promise<CallToolResult> {
    return {
      content: [{ type: 'text', text: String(input.a + input.b) }],
    };
  }
}
