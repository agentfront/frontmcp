import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  bytes: z.number().int().min(1).max(8_000_000).describe('How long the document is, in bytes'),
};

@Tool({
  name: 'docs-read',
  description: 'Read a document of the given size, as one string',
  inputSchema,
  outputSchema: 'string',
})
export default class DocsReadTool extends ToolContext {
  async execute(input: z.infer<z.ZodObject<typeof inputSchema>>): Promise<string> {
    return 'd'.repeat(input.bytes);
  }
}
