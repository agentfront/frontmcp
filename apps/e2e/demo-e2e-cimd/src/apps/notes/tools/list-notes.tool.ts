import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = z.object({});

const outputSchema = z.object({
  notes: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      preview: z.string(),
    }),
  ),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'list-notes',
  description: 'List all notes',
  inputSchema,
  outputSchema,
})
export default class ListNotesTool extends ToolContext<Input, Output> {
  async execute(_input: Input): Promise<Output> {
    // Return mock notes for testing
    return {
      notes: [
        { id: 'note-1', title: 'Welcome', preview: 'Welcome to the notes app...' },
        { id: 'note-2', title: 'Getting Started', preview: 'Here is how to get started...' },
      ],
    };
  }
}
