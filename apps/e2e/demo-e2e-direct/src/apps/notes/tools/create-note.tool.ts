import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { notesStore } from '../data/notes.store';

const inputSchema = z
  .object({
    title: z.string().describe('Title of the note'),
    content: z.string().describe('Content of the note'),
  })
  .strict();

const outputSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  createdAt: z.string(),
});

type CreateNoteInput = z.infer<typeof inputSchema>;
type CreateNoteOutput = z.infer<typeof outputSchema>;

@Tool({
  name: 'create-note',
  description: 'Create a new note with title and content',
  inputSchema,
  outputSchema,
})
export default class CreateNoteTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: CreateNoteInput): Promise<CreateNoteOutput> {
    const note = {
      id: `note-${Date.now()}`,
      title: input.title,
      content: input.content,
      createdAt: new Date().toISOString(),
    };

    notesStore.add(note);

    return note;
  }
}
