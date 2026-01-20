import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = z.object({
  title: z.string().describe('Note title'),
  content: z.string().describe('Note content'),
});

const outputSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  createdAt: z.string(),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'create-note',
  description: 'Create a new note',
  inputSchema,
  outputSchema,
})
export default class CreateNoteTool extends ToolContext<Input, Output> {
  async execute(input: Input): Promise<Output> {
    return {
      id: `note-${Date.now()}`,
      title: input.title,
      content: input.content,
      createdAt: new Date().toISOString(),
    };
  }
}
