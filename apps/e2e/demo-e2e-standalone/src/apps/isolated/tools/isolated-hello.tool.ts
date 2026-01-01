import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'isolated-hello',
  description: 'A simple hello tool in the isolated standalone app',
  inputSchema: z.object({
    name: z.string().optional().default('World'),
  }),
  outputSchema: z.object({
    message: z.string(),
    scope: z.literal('isolated'),
  }),
})
export default class IsolatedHelloTool extends ToolContext {
  async execute({ name }: { name: string }): Promise<{ message: string; scope: 'isolated' }> {
    return {
      message: `Hello, ${name}! This is from the isolated standalone app.`,
      scope: 'isolated' as const,
    };
  }
}
