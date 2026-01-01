import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'parent-hello',
  description: 'A simple hello tool in the parent/root scope',
  inputSchema: z.object({
    name: z.string().optional().default('World'),
  }),
  outputSchema: z.object({
    message: z.string(),
    scope: z.literal('parent'),
  }),
})
export default class ParentHelloTool extends ToolContext<{ name?: string }, { message: string; scope: 'parent' }> {
  async execute() {
    const { name } = this.input;
    return {
      message: `Hello, ${name}! This is from the parent/root scope.`,
      scope: 'parent' as const,
    };
  }
}
