import { z } from 'zod';

import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = { message: z.string().default('hello') };
type Input = z.infer<z.ZodObject<typeof inputSchema>>;

@Tool({
  name: 'public-tool',
  description: 'A tool with no authorities — accessible to everyone',
  inputSchema,
})
export default class PublicTool extends ToolContext {
  async execute(input: Input) {
    return { echo: input.message };
  }
}
