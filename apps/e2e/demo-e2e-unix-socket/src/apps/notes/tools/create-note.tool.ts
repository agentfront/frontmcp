import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { notesStore } from '../data/notes.store';

const inputSchema = {
  title: z.string().describe('Title of the note'),
  content: z.string().describe('Content of the note'),
};

const outputSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  createdAt: z.string(),
});

type CreateNoteInput = z.input<z.ZodObject<typeof inputSchema>>;
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
      id: `note-${randomUUID()}`,
      title: input.title,
      content: input.content,
      createdAt: new Date().toISOString(),
    };

    notesStore.add(note);

    return note;
  }
}
