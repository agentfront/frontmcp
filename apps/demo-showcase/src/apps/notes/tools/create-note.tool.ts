import { Tool, ToolContext } from '@frontmcp/sdk';
import z from 'zod';
import { notesStore } from '../data/store';

@Tool({
  name: 'create-note',
  description: 'Create a new note with title, content, and optional tags',
  inputSchema: {
    title: z.string().min(1).describe('The title of the note'),
    content: z.string().min(1).describe('The content of the note'),
    tags: z.array(z.string()).optional().describe('Optional tags for categorization'),
  },
  outputSchema: {
    id: z.string(),
    title: z.string(),
    content: z.string(),
    tags: z.array(z.string()),
    createdAt: z.string(),
    updatedAt: z.string(),
  },
})
export default class CreateNoteTool extends ToolContext {
  async execute(input: { title: string; content: string; tags?: string[] }) {
    const note = notesStore.create({
      title: input.title,
      content: input.content,
      tags: input.tags,
    });
    return note;
  }
}
