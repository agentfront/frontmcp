import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { noteStore } from '../data/note.store';

const inputSchema = {};

const outputSchema = z.object({
  notes: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      content: z.string(),
      createdAt: z.number(),
    }),
  ),
  count: z.number(),
});

type Input = z.input<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'list-notes',
  description: 'List all notes',
  inputSchema,
  outputSchema,
})
export default class ListNotesTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(_input: Input): Promise<Output> {
    const notes = noteStore.getAll();

    return {
      notes: notes.map((n) => ({
        id: n.id,
        title: n.title,
        content: n.content,
        createdAt: n.createdAt,
      })),
      count: notes.length,
    };
  }
}
