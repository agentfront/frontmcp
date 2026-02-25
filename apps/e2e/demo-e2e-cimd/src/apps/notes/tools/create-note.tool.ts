import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = {
  title: z.string().describe('Note title'),
  content: z.string().describe('Note content'),
};

const outputSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  createdAt: z.string(),
});

type Input = z.input<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'create-note',
  description: 'Create a new note',
  inputSchema,
  outputSchema,
})
export default class CreateNoteTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    return {
      id: `note-${Date.now()}`,
      title: input.title,
      content: input.content,
      createdAt: new Date().toISOString(),
    };
  }
}
