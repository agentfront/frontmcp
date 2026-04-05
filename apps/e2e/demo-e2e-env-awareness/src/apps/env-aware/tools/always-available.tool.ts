import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = { name: z.string().default('World') };

@Tool({
  name: 'always_available',
  description: 'A tool with no availableWhen constraint — always visible',
  inputSchema,
})
export default class AlwaysAvailableTool extends ToolContext {
  async execute(input: { name: string }) {
    return `Hello, ${input.name}! I am always available.`;
  }
}
