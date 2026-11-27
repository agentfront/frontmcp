import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

@Tool({
  name: 'slow-wait',
  description: 'Waits the given number of milliseconds without sending anything, then answers',
  inputSchema: { ms: z.number().int().min(1).max(10_000) },
})
export default class SlowWaitTool extends ToolContext {
  async execute(input: { ms: number }): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, input.ms));
    return `waited ${input.ms} ms`;
  }
}
