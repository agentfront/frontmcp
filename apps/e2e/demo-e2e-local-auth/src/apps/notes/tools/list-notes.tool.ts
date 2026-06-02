import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {};

const outputSchema = z.object({
  notes: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      preview: z.string(),
    }),
  ),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'list-notes',
  description: 'List all notes',
  inputSchema,
  outputSchema,
})
export default class ListNotesTool extends ToolContext {
  async execute(_input: Input): Promise<Output> {
    return {
      notes: [
        { id: 'note-1', title: 'Welcome', preview: 'Welcome to the notes app...' },
        { id: 'note-2', title: 'Getting Started', preview: 'Here is how to get started...' },
      ],
    };
  }
}
