import { Tool, ToolContext } from '@frontmcp/sdk';
import z from 'zod';
import { notesStore } from '../data/store';

@Tool({
  name: 'get-note',
  description: 'Get a specific note by its ID',
  inputSchema: {
    id: z.string().min(1).describe('The ID of the note to retrieve'),
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
export default class GetNoteTool extends ToolContext {
  async execute(input: { id: string }) {
    const note = notesStore.get(input.id);
    if (!note) {
      throw new Error(`Note with ID "${input.id}" not found`);
    }
    return note;
  }
}
