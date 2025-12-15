import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { notesStore } from '../data/notes.store';

const inputSchema = z
  .object({
    _dummy: z.string().optional().describe('Unused parameter'),
  })
  .strict();

const outputSchema = z.object({
  notes: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      content: z.string(),
      createdAt: z.string(),
    }),
  ),
  count: z.number(),
});

type ListNotesInput = z.infer<z.ZodObject<typeof inputSchema>>;
type ListNotesOutput = z.infer<typeof outputSchema>;

@Tool({
  name: 'list-notes',
  description: 'List all notes',
  inputSchema,
  outputSchema,
})
export default class ListNotesTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(_input: ListNotesInput): Promise<ListNotesOutput> {
    const notes = notesStore.getAll();
    return {
      notes,
      count: notes.length,
    };
  }
}
