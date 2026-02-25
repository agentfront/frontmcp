import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { noteStore } from '../data/note.store';

const inputSchema = {
  title: z.string().min(1).describe('Note title'),
  content: z.string().min(1).describe('Note content'),
};

const outputSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  createdAt: z.number(),
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
    const store = noteStore;
    const note = store.create(input.title, input.content);

    return {
      id: note.id,
      title: note.title,
      content: note.content,
      createdAt: note.createdAt,
    };
  }
}
